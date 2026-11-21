use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;
use domainlint_graph::{CliOverrides, Config, RunOptions, report, run};

/// Native domainlint (import cycles + feature boundaries). Prints violations like
/// `domainlint check . --no-color`.
#[derive(Parser)]
#[command(name = "domainlint-rs", version)]
struct Cli {
    /// Project root
    #[arg(default_value = ".")]
    path: PathBuf,
    /// Config file (relative to the project root), e.g. domainlint.json
    #[arg(short, long)]
    config: Option<String>,
    #[arg(long)]
    src_dir: Option<String>,
    #[arg(long)]
    features_dir: Option<String>,
    #[arg(long)]
    tsconfig_path: Option<String>,
    #[arg(long)]
    include_dynamic_imports: bool,
    /// Accepted for compatibility; output is always plain.
    #[arg(long)]
    no_color: bool,
    /// Print a phase breakdown to stderr.
    #[arg(long)]
    timings: bool,
    /// Also compute Tarjan SCC stats (printed with --timings, or as a stderr line).
    #[arg(long)]
    scc: bool,
}

fn ms(d: std::time::Duration) -> String {
    format!("{:8.2} ms", d.as_secs_f64() * 1000.0)
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match real_main(cli) {
        Ok(code) => code,
        Err(e) => {
            eprintln!("Internal error: {e:#}");
            ExitCode::from(2)
        }
    }
}

fn real_main(cli: Cli) -> anyhow::Result<ExitCode> {
    let overrides = CliOverrides {
        src_dir: cli.src_dir,
        features_dir: cli.features_dir,
        tsconfig_path: cli.tsconfig_path,
        include_dynamic_imports: cli.include_dynamic_imports.then_some(true),
    };
    let config = Config::load(&cli.path, cli.config.as_deref(), &overrides)?;
    let result = run(&config, &RunOptions { scc: cli.scc })?;

    {
        let stdout = std::io::stdout();
        let mut out = BufWriter::new(stdout.lock());
        let w = |out: &mut BufWriter<_>, s: &str| -> bool { writeln!(out, "{s}").is_ok() };
        let _ = w(
            &mut out,
            &format!(
                "Analyzed {} files in {}ms",
                result.file_count,
                result.timings.total.as_millis()
            ),
        );
        let _ = w(&mut out, "");
        for v in &result.violations {
            if !w(&mut out, &report::format_violation(v, &config.root_dir)) {
                break;
            }
        }
        let _ = w(&mut out, "");
        let _ = w(&mut out, &report::format_summary(&result.violations));
        let _ = out.flush();
    }

    if cli.timings || cli.scc {
        let t = &result.timings;
        let mut e = std::io::stderr().lock();
        if cli.timings {
            let _ = writeln!(e, "--- domainlint-rs timings ---");
            let _ = writeln!(e, "walk              {}", ms(t.walk));
            let _ = writeln!(e, "read+parse        {}", ms(t.read_parse));
            let _ = writeln!(e, "resolve           {}", ms(t.resolve));
            let _ = writeln!(e, "graph build       {}", ms(t.graph_build));
            let _ = writeln!(
                e,
                "cycles            {}{}",
                ms(t.cycles),
                if t.cycles_skipped {
                    "  (rule off: skipped; Node computes then filters)"
                } else {
                    ""
                }
            );
            let _ = writeln!(
                e,
                "boundaries        {}{}",
                ms(t.boundaries),
                if t.boundaries_skipped {
                    "  (rule off: skipped; Node computes then filters)"
                } else {
                    ""
                }
            );
            if cli.scc {
                let _ = writeln!(e, "scc (tarjan)      {}", ms(t.scc));
            }
            let _ = writeln!(e, "total             {}", ms(t.total));
            let _ = writeln!(
                e,
                "files={} imports={} edges={} threads={}",
                result.file_count,
                result.import_count,
                result.edge_count,
                rayon::current_num_threads()
            );
        }
        if let Some(s) = result.scc {
            let _ = writeln!(
                e,
                "scc: {} cyclic component(s), {} node(s) in cycles, largest {}",
                s.cyclic_sccs, s.nodes_in_cycles, s.largest
            );
        }
    }

    Ok(if result.violations.is_empty() {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    })
}
