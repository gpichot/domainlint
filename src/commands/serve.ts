import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Args, Command, Flags } from '@oclif/core';
import react from '@vitejs/plugin-react';
import { createServer as createViteServer } from 'vite';
import { loadConfig } from '../config/config-loader.js';
import { FeatureBoundariesLinter } from '../linter/feature-boundaries-linter.js';
import { GraphExporter } from '../services/graph-exporter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, '..', '..');

export default class Serve extends Command {
  static override args = {
    path: Args.string({
      description: 'Path to the project to analyze',
      default: '.',
    }),
  };

  static override description =
    'Launch a web server to visualize the dependency graph';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> ./my-project',
    '<%= config.bin %> <%= command.id %> --port 8080',
  ];

  static override flags = {
    config: Flags.string({ char: 'c', description: 'Path to config file' }),
    'src-dir': Flags.string({ description: 'Source directory (default: src)' }),
    'features-dir': Flags.string({
      description: 'Features directory (default: src/features)',
    }),
    'tsconfig-path': Flags.string({
      description: 'Path to tsconfig.json (default: ./tsconfig.json)',
    }),
    'include-dynamic-imports': Flags.boolean({
      description: 'Include dynamic imports in analysis',
    }),
    port: Flags.integer({
      char: 'p',
      description: 'Port to run the server on',
      default: 3000,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Serve);

    try {
      this.log('Loading configuration...');

      // Load configuration
      const config = await loadConfig(args.path, flags.config, {
        srcDir: flags['src-dir'],
        featuresDir: flags['features-dir'],
        tsconfigPath: flags['tsconfig-path'],
        includeDynamicImports: flags['include-dynamic-imports'],
      });

      this.log('Analyzing dependency graph...');

      // Run linter to get dependency graph
      const linter = new FeatureBoundariesLinter(config);
      const result = await linter.lint();

      this.log(
        `Analyzed ${result.fileCount} files in ${result.analysisTimeMs}ms`,
      );

      // Export graph data
      const exporter = new GraphExporter(config);
      const graphData = exporter.exportGraph(result.dependencyGraph);

      this.log('Starting development server...');

      // Create Vite server
      const vite = await createViteServer({
        configFile: false,
        root: join(packageRoot, 'src', 'web'),
        publicDir: false,
        server: {
          middlewareMode: true,
          port: flags.port,
        },
        plugins: [
          react(),
          {
            name: 'domainlint-api',
            configureServer(server) {
              server.middlewares.use((req, res, next) => {
                if (req.url === '/api/graph') {
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify(graphData));
                  return;
                }
                next();
              });
            },
          },
        ],
      });

      // Create HTTP server
      const server = createServer((req, res) => {
        vite.middlewares(req, res);
      });

      server.listen(flags.port, () => {
        this.log('');
        this.log(`Graph visualization server running at:`);
        this.log(`  http://localhost:${flags.port}`);
        this.log('');
        this.log('Press Ctrl+C to stop');
      });

      // Handle shutdown
      const shutdown = async () => {
        this.log('\nShutting down server...');
        await vite.close();
        server.close();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    } catch (error) {
      this.error(
        `Failed to start server: ${error instanceof Error ? error.message : String(error)}`,
        { exit: 2 },
      );
    }
  }
}
