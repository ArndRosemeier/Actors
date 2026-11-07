use thiserror::Error;

/// Everything that can go wrong loading or evaluating a pack.
#[derive(Debug, Error)]
pub enum Error {
    #[error("{path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("{path}: invalid JSON: {source}")]
    Json {
        path: String,
        #[source]
        source: serde_json::Error,
    },
    /// The data does not follow the pack format (bad magic, out-of-range buffer, ...).
    #[error("invalid pack data: {0}")]
    Format(String),
    /// A name (mesh, proxy, target, clip, bone) the pack does not have.
    #[error("unknown {kind} {name}")]
    Unknown { kind: &'static str, name: String },
    /// Data that has to be loaded first (see `ActorRuntime::ensure_targets`).
    #[error("{0} not loaded")]
    NotLoaded(String),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

impl Error {
    pub(crate) fn format(msg: impl Into<String>) -> Self {
        Error::Format(msg.into())
    }
    pub(crate) fn unknown(kind: &'static str, name: impl Into<String>) -> Self {
        Error::Unknown { kind, name: name.into() }
    }
}
