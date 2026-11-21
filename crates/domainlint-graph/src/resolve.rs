//! Module resolution. Mirrors `packages/domainlint/src/resolution/module-resolver.ts`.

use oxc_resolver::{
    ResolveOptions, Resolver, TsconfigDiscovery, TsconfigOptions, TsconfigReferences,
};

use crate::config::Config;

pub fn build_resolver(config: &Config) -> Resolver {
    // `b.replace(/\.[^.]+$/, '')`
    let main_files = config
        .barrel_files
        .iter()
        .map(|b| match b.rfind('.') {
            Some(i) if i + 1 < b.len() => b[..i].to_string(),
            _ => b.clone(),
        })
        .collect();
    Resolver::new(ResolveOptions {
        tsconfig: Some(TsconfigDiscovery::Manual(TsconfigOptions {
            config_file: config.tsconfig_path.clone(),
            references: TsconfigReferences::Auto,
        })),
        extensions: config.extensions.clone(),
        main_files,
        condition_names: vec!["node".into(), "import".into(), "require".into()],
        ..ResolveOptions::default()
    })
}

/// Returns the resolved absolute path, or `None` for external / unresolved specifiers.
pub fn resolve_local(resolver: &Resolver, from_file: &str, specifier: &str) -> Option<String> {
    let dir = std::path::Path::new(from_file).parent()?;
    match resolver.resolve(dir, specifier) {
        Ok(r) => {
            let p = r.path().to_string_lossy();
            if p.contains("/node_modules/") || p.contains("\\node_modules\\") {
                None
            } else {
                Some(p.into_owned())
            }
        }
        Err(_) => None,
    }
}
