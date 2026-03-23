import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LintOrchestrator } from './lint-orchestrator.js';

// Mock the dependencies
vi.mock('../config/config-loader.js');
vi.mock('../files/file-discovery.js');
vi.mock('../linter/feature-boundaries-linter.js');
vi.mock('./statistics-calculator.js');
vi.mock('./violation-filter.js');

describe('LintOrchestrator', () => {
  let orchestrator: LintOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    orchestrator = new LintOrchestrator();
  });

  describe('constructor', () => {
    it('should initialize services', () => {
      expect(orchestrator).toBeInstanceOf(LintOrchestrator);
    });
  });

  describe('analyzeExistingViolations', () => {
    it('should delegate to violation filter service', () => {
      const mockViolations = [
        {
          code: 'noImportCycle',
          file: '/test/file.ts',
          line: 1,
          col: 1,
          message: 'Cycle detected',
        },
      ];

      // Since we're mocking the ViolationFilterService, we need to mock its methods
      const mockViolationFilter = orchestrator['violationFilter'] as any;
      mockViolationFilter.analyzeViolations = vi.fn().mockReturnValue({
        cycleCount: 1,
        boundaryViolationCount: 0,
        totalCount: 1,
        violationsByType: { noImportCycle: 1 },
      });

      const result = orchestrator.analyzeExistingViolations(mockViolations);

      expect(mockViolationFilter.analyzeViolations).toHaveBeenCalledWith(
        mockViolations,
      );
      expect(result).toEqual({
        cycleCount: 1,
        boundaryViolationCount: 0,
        totalCount: 1,
        violationsByType: { noImportCycle: 1 },
      });
    });
  });

  describe('quickLint', () => {
    it('should call executeLinting with correct parameters', async () => {
      const mockExecuteLinting = vi
        .spyOn(orchestrator, 'executeLinting')
        .mockResolvedValue({
          violations: [],
          analysisTimeMs: 100,
          fileCount: 5,
          hasViolations: false,
        });

      const result = await orchestrator.quickLint('/project', '/config.json');

      expect(mockExecuteLinting).toHaveBeenCalledWith({
        projectPath: '/project',
        configPath: '/config.json',
        includeFeatureStats: true,
      });

      expect(result).toEqual({
        violations: [],
        analysisTimeMs: 100,
        fileCount: 5,
        hasViolations: false,
      });
    });
  });

  describe('formatResults', () => {
    it('should format results using reporter', () => {
      const mockResult = {
        violations: [
          {
            code: 'noImportCycle',
            file: '/project/src/features/auth/user.ts',
            line: 1,
            col: 1,
            message:
              'Import cycle detected: /project/src/features/auth/user.ts -> /project/src/features/auth/service.ts -> /project/src/features/auth/user.ts',
          },
        ],
        analysisTimeMs: 100,
        fileCount: 5,
        hasViolations: true,
        allFeatures: ['auth'],
      };

      const mockConfig = {
        rootDir: '/project',
        srcDir: '/project/src',
        featuresDir: '/project/src/features',
        barrelFiles: ['index.ts'],
        extensions: ['.ts'],
        tsconfigPath: '/project/tsconfig.json',
        exclude: [],
        includeDynamicImports: false,
      };

      const result = orchestrator.formatResults(mockResult, mockConfig);

      expect(result.violationOutput).toHaveLength(1);
      expect(result.violationOutput[0]).toContain('noImportCycle');
      expect(result.summaryOutput).toContain('1 import cycle');
      expect(result.domainSummaryOutput).toContain('Feature Status:');
      expect(result.cycleAnalysisOutput).toContain('Cycle Analysis');
    });

    it('should include feature name in summary when filtering by feature', () => {
      const mockResult = {
        violations: [],
        analysisTimeMs: 100,
        fileCount: 5,
        hasViolations: false,
      };

      const mockConfig = {
        rootDir: '/project',
        srcDir: '/project/src',
        featuresDir: '/project/src/features',
        barrelFiles: ['index.ts'],
        extensions: ['.ts'],
        tsconfigPath: '/project/tsconfig.json',
        exclude: [],
        includeDynamicImports: false,
      };

      const result = orchestrator.formatResults(
        mockResult,
        mockConfig,
        {},
        { feature: 'auth' },
      );

      expect(result.summaryOutput).toContain('feature "auth"');
    });
  });
});
