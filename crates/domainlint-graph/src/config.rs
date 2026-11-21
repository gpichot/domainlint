//! Config loading. Mirrors `packages/domainlint/src/config/config-loader.ts`
//! (defaults, file names, priority: CLI overrides > config file > defaults).

use std::path::{Component, Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Off,
    Warn,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuleName {
    ImportCycles,
    CrossFeatureImports,
    NoExternalFeatureImports,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RuleLevels {
    #[serde(rename = "import-cycles")]
    pub import_cycles: Option<Level>,
    #[serde(rename = "cross-feature-imports")]
    pub cross_feature_imports: Option<Level>,
    #[serde(rename = "no-external-feature-imports")]
    pub no_external_feature_imports: Option<Level>,
}

impl RuleLevels {
    pub fn get(&self, rule: RuleName) -> Option<Level> {
        match rule {
            RuleName::ImportCycles => self.import_cycles,
            RuleName::CrossFeatureImports => self.cross_feature_imports,
            RuleName::NoExternalFeatureImports => self.no_external_feature_imports,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RuleOverride {
    pub rules: Option<RuleLevels>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Overrides {
    pub global: Option<RuleOverride>,
    pub features: Option<std::collections::HashMap<String, RuleOverride>>,
}

/// Shape of `domainlint.json` (fields we honour; unknown keys are ignored like zod's default).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigFile {
    src_dir: Option<String>,
    features_dir: Option<String>,
    barrel_files: Option<Vec<String>>,
    extensions: Option<Vec<String>>,
    tsconfig_path: Option<String>,
    exclude: Option<Vec<String>>,
    include_dynamic_imports: Option<bool>,
    overrides: Option<Overrides>,
}

#[derive(Debug, Clone, Default)]
pub struct CliOverrides {
    pub src_dir: Option<String>,
    pub features_dir: Option<String>,
    pub tsconfig_path: Option<String>,
    pub include_dynamic_imports: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub root_dir: PathBuf,
    pub src_dir: PathBuf,
    pub features_dir: PathBuf,
    pub barrel_files: Vec<String>,
    pub extensions: Vec<String>,
    pub tsconfig_path: PathBuf,
    pub exclude: Vec<String>,
    pub include_dynamic_imports: bool,
    pub overrides: Overrides,
}

/// Lexical equivalent of Node's `path.resolve(base, p)` (no filesystem access).
pub fn resolve_path(base: &Path, p: &str) -> PathBuf {
    let joined = if Path::new(p).is_absolute() {
        PathBuf::from(p)
    } else {
        base.join(p)
    };
    let mut out = PathBuf::new();
    for c in joined.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

impl Config {
    pub fn load(
        project_path: &Path,
        config_file: Option<&str>,
        cli: &CliOverrides,
    ) -> Result<Config> {
        let cwd = std::env::current_dir()?;
        let root_dir = resolve_path(&cwd, &project_path.to_string_lossy());

        let raw: Option<String> = if let Some(cf) = config_file {
            let p = resolve_path(&root_dir, cf);
            Some(
                std::fs::read_to_string(&p)
                    .with_context(|| format!("Failed to load config file {cf}"))?,
            )
        } else {
            ["domainlint.json", ".domainlint.json"]
                .iter()
                .find_map(|n| std::fs::read_to_string(root_dir.join(n)).ok())
        };

        let file: ConfigFile = match raw {
            Some(text) => {
                // JSONC: strip comments (trailing commas are NOT supported, unlike jsonc-parser).
                let stripped = json_comments::StripComments::new(text.as_bytes());
                serde_json::from_reader(stripped)
                    .map_err(|e| anyhow::anyhow!("Invalid config: {e}"))?
            }
            None => ConfigFile::default(),
        };

        let src = cli
            .src_dir
            .clone()
            .or(file.src_dir)
            .unwrap_or_else(|| "src".into());
        let features = cli
            .features_dir
            .clone()
            .or(file.features_dir)
            .unwrap_or_else(|| "src/features".into());
        let tsconfig = cli
            .tsconfig_path
            .clone()
            .or(file.tsconfig_path)
            .unwrap_or_else(|| "./tsconfig.json".into());

        let config = Config {
            src_dir: resolve_path(&root_dir, &src),
            features_dir: resolve_path(&root_dir, &features),
            tsconfig_path: resolve_path(&root_dir, &tsconfig),
            barrel_files: file.barrel_files.unwrap_or_else(|| vec!["index.ts".into()]),
            // NOTE: the Node default is [".ts", ".tsx", ".d.ts"] (config-loader.ts), not just ts/tsx.
            extensions: file
                .extensions
                .unwrap_or_else(|| vec![".ts".into(), ".tsx".into(), ".d.ts".into()]),
            exclude: file.exclude.unwrap_or_else(|| {
                vec![
                    "**/node_modules/**".into(),
                    "**/dist/**".into(),
                    "**/.next/**".into(),
                ]
            }),
            include_dynamic_imports: cli
                .include_dynamic_imports
                .or(file.include_dynamic_imports)
                .unwrap_or(false),
            overrides: file.overrides.unwrap_or_default(),
            root_dir,
        };

        if !config.src_dir.exists() {
            bail!(
                "Invalid config: \"srcDir\" does not exist: {}",
                config.src_dir.display()
            );
        }
        if !config.features_dir.exists() {
            bail!(
                "Invalid config: \"featuresDir\" does not exist: {}",
                config.features_dir.display()
            );
        }
        Ok(config)
    }

    /// Port of `checkRuleOverride` (rule-overrides.ts): effective level of `rule` for a violation in `file`.
    pub fn effective_level(&self, rule: RuleName, file: &str) -> Level {
        let mut level = if rule == RuleName::NoExternalFeatureImports {
            Level::Off
        } else {
            Level::Error
        };
        if let Some(l) = self
            .overrides
            .global
            .as_ref()
            .and_then(|g| g.rules.as_ref())
            .and_then(|r| r.get(rule))
        {
            level = l;
        }
        if let Some(features) = self.overrides.features.as_ref() {
            let fd = self.features_dir.to_string_lossy();
            // Node: `startsWith(featuresDir)` (no trailing slash!) then `split('/')[1]` of the remainder.
            if let Some(l) = file
                .strip_prefix(fd.as_ref())
                .and_then(|rest| rest.split('/').nth(1))
                .and_then(|name| features.get(name))
                .and_then(|o| o.rules.as_ref())
                .and_then(|r| r.get(rule))
            {
                level = l;
            }
        }
        level
    }

    /// True if `rule` could be enabled for at least one file (global level or any feature override).
    /// Used to skip computing a rule entirely (Node computes everything and filters afterwards).
    pub fn rule_possibly_enabled(&self, rule: RuleName) -> bool {
        let mut global = if rule == RuleName::NoExternalFeatureImports {
            Level::Off
        } else {
            Level::Error
        };
        if let Some(l) = self
            .overrides
            .global
            .as_ref()
            .and_then(|g| g.rules.as_ref())
            .and_then(|r| r.get(rule))
        {
            global = l;
        }
        if global != Level::Off {
            return true;
        }
        self.overrides.features.as_ref().is_some_and(|f| {
            f.values().any(|o| {
                o.rules
                    .as_ref()
                    .and_then(|r| r.get(rule))
                    .is_some_and(|l| l != Level::Off)
            })
        })
    }
}
