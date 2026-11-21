//! Module resolution. Mirrors `packages/domainlint/src/resolution/module-resolver.ts`.

use oxc_resolver::{
    ResolveOptions, Resolver, TsconfigDiscovery, TsconfigOptions, TsconfigReferences,
};

use std::path::{Path, PathBuf};

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
        // Keep resolved paths in the same form as the walked ones. With
        // symlink resolution on, a root under a symlink (macOS /var ->
        // /private/var, symlinked checkouts) resolves to real paths that no
        // longer match any discovered file, so every edge is dropped.
        symlinks: false,
        ..ResolveOptions::default()
    })
}

/// Resolver plus the mapping that keeps resolved paths in the caller's form.
pub struct LocalResolver {
    resolver: Resolver,
    /// `(canonical root, root as given)` when the project root sits behind a
    /// symlink. oxc_resolver canonicalises the tsconfig location, so alias
    /// targets (`@/*`) come back as real paths even with `symlinks: false`.
    root_map: Option<(PathBuf, PathBuf)>,
}

pub fn build_local_resolver(config: &Config) -> LocalResolver {
    let root_map = std::fs::canonicalize(&config.root_dir)
        .ok()
        .map(|canon| strip_verbatim(&canon))
        .filter(|canon| canon != &config.root_dir)
        .map(|canon| (canon, config.root_dir.clone()));
    LocalResolver {
        resolver: build_resolver(config),
        root_map,
    }
}

/// On Windows `fs::canonicalize` returns verbatim paths (`\\?\C:\...`, `\\?\UNC\...`) that
/// never match the plain paths used everywhere else; strip the prefix. No-op for other paths.
fn strip_verbatim(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        p.to_path_buf()
    }
}

/// Returns the resolved absolute path, or `None` for external / unresolved specifiers.
pub fn resolve_local(resolver: &LocalResolver, from_file: &str, specifier: &str) -> Option<String> {
    let dir = Path::new(from_file).parent()?;
    let resolved = resolver.resolver.resolve(dir, specifier).ok()?;
    let mut path = resolved.path().to_path_buf();
    if let Some((canon, given)) = &resolver.root_map
        && let Ok(rest) = path.strip_prefix(canon)
    {
        path = given.join(rest);
    }
    let p = path.to_string_lossy();
    if p.contains("/node_modules/") || p.contains("\\node_modules\\") {
        None
    } else {
        Some(p.into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_verbatim_removes_windows_prefixes() {
        let s = |p: &str| strip_verbatim(Path::new(p)).to_string_lossy().into_owned();
        assert_eq!(s(r"\\?\C:\proj\src"), r"C:\proj\src");
        assert_eq!(s(r"\\?\UNC\server\share\x"), r"\\server\share\x");
        assert_eq!(s("/home/proj"), "/home/proj");
        assert_eq!(s(r"C:\proj"), r"C:\proj");
    }
}
