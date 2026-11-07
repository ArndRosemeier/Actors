//! Where pack files come from. The runtime asks for files by their path relative to the
//! manifest's folder; implement [`PackSource`] to read them from an archive, the network or
//! memory.

use crate::error::{Error, Result};
use std::path::{Path, PathBuf};

/// Reads pack files by path (`/`-separated, relative to the source's root).
pub trait PackSource: Send + Sync {
    fn read(&self, path: &str) -> Result<Vec<u8>>;
}

/// Files in a folder on disk, e.g. `public/packs` with `human/manifest.json` inside.
#[derive(Clone, Debug)]
pub struct DirSource {
    root: PathBuf,
}

impl DirSource {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }
    pub fn root(&self) -> &Path {
        &self.root
    }
}

impl PackSource for DirSource {
    fn read(&self, path: &str) -> Result<Vec<u8>> {
        if path.split('/').any(|p| p == "..") {
            return Err(Error::format(format!("{path}: path leaves the pack folder")));
        }
        let full = self.root.join(path);
        std::fs::read(&full).map_err(|source| Error::Io { path: full.display().to_string(), source })
    }
}

impl<T: PackSource + ?Sized> PackSource for std::sync::Arc<T> {
    fn read(&self, path: &str) -> Result<Vec<u8>> {
        (**self).read(path)
    }
}

impl<T: PackSource + ?Sized> PackSource for Box<T> {
    fn read(&self, path: &str) -> Result<Vec<u8>> {
        (**self).read(path)
    }
}

/// Files held in memory (embedded packs, tests).
#[derive(Clone, Debug, Default)]
pub struct MemSource {
    files: std::collections::HashMap<String, std::sync::Arc<[u8]>>,
}

impl MemSource {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn insert(&mut self, path: impl Into<String>, data: impl Into<std::sync::Arc<[u8]>>) -> &mut Self {
        self.files.insert(path.into(), data.into());
        self
    }
}

impl PackSource for MemSource {
    fn read(&self, path: &str) -> Result<Vec<u8>> {
        self.files.get(path).map(|d| d.to_vec()).ok_or_else(|| Error::Io {
            path: path.to_string(),
            source: std::io::Error::new(std::io::ErrorKind::NotFound, "not in the in-memory pack"),
        })
    }
}
