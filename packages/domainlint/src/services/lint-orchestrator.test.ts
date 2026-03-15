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
          code: 'ARCH_IMPORT_CYCLE',
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
        violationsByType: { ARCH_IMPORT_CYCLE: 1 },
      });

      const result = orchestrator.analyzeExistingViolations(mockViolations);

      expect(mockViolationFilter.analyzeViolations).toHaveBeenCalledWith(
        mockViolations,
      );
      expect(result).toEqual({
        cycleCount: 1,
        boundaryViolationCount: 0,
        totalCount: 1,
        violationsByType: { ARCH_IMPORT_CYCLE: 1 },
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
            code: 'ARCH_IMPORT_CYCLE',
            file: '/test/file.ts',
            line: 1,
            col: 1,
            message: 'Cycle detected',
          },
        ],
        analysisTimeMs: 100,
        fileCount: 5,
        hasViolations: true,
        allFeatures: ['auth', 'billing'],
        featureStats: [
          {
            feature: 'auth',
            fileCount: 3,
            linesOfCode: 100,
            dependencies: [],
          },
        ],
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

      // Mock the ColoredReporter methods
      const mockFormatViolation = vi
        .fn()
        .mockReturnValue('Formatted violation');
      const mockFormatSummary = vi.fn().mockReturnValue('Summary');
      const mockFormatDomainSummary = vi.fn().mockReturnValue('Domain summary');
      const mockFormatCycleAnalysis = vi.fn().mockReturnValue('Cycle analysis');

      // We need to mock the ColoredReporter import
      vi.doMock('../reporter/colored-reporter.js', () => ({
        ColoredReporter: vi.fn().mockImplementation(() => ({
          formatViolation: mockFormatViolation,
          formatSummary: mockFormatSummary,
          formatDomainSummary: mockFormatDomainSummary,
          formatCycleAnalysis: mockFormatCycleAnalysis,
        })),
      }));

      const result = orchestrator.formatResults(mockResult, mockConfig);

      expect(result).toEqual({
        violationOutput: ['Formatted violation'],
        summaryOutput: 'Summary',
        domainSummaryOutput: 'Domain summary',
        cycleAnalysisOutput: 'Cycle analysis',
      });
    });

    it('should handle feature-specific summary context', () => {
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

      const mockFormatSummary = vi.fn().mockReturnValue('Feature summary');

      vi.doMock('../reporter/colored-reporter.js', () => ({
        ColoredReporter: vi.fn().mockImplementation(() => ({
          formatViolation: vi.fn(),
          formatSummary: mockFormatSummary,
          formatDomainSummary: vi.fn().mockReturnValue(null),
          formatCycleAnalysis: vi.fn().mockReturnValue(null),
        })),
      }));

      const result = orchestrator.formatResults(
        mockResult,
        mockConfig,
        {},
        { feature: 'auth' },
      );

      expect(mockFormatSummary).toHaveBeenCalledWith(
        mockResult.violations,
        'feature "auth"',
      );
      expect(result.summaryOutput).toBe('Feature summary');
    });
  });
});
