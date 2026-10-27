//! Bounded, read-only access to a file's bytes for the item snapshot, plus the integer helpers the
//! container parsers share. Every length read from a file is checked against the file before
//! anything is allocated, so a corrupt size field is an error, never a huge allocation.

use crate::error::{Error, Result};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// A file opened read-only for the snapshot.
pub(super) struct Source<'p> {
  file: File,
  pub len: u64,
  path: &'p Path,
}

impl<'p> Source<'p> {
  pub fn open(path: &'p Path) -> Result<Self> {
    let file = File::open(path)?;
    let len = file.metadata()?.len();
    Ok(Source { file, len, path })
  }

  /// Exactly `len` bytes at `pos`; an error when they lie past the end of the file.
  pub fn read_at(&mut self, pos: u64, len: u64) -> Result<Vec<u8>> {
    if pos.checked_add(len).is_none_or(|end| end > self.len) {
      return Err(self.malformed(format!("{len} bytes at offset {pos} lie past the end of the file")));
    }
    let n = usize::try_from(len).map_err(|_| self.malformed("a metadata block is too large"))?;
    let mut buf = vec![0; n];
    self.file.seek(SeekFrom::Start(pos))?;
    self.file.read_exact(&mut buf)?;
    Ok(buf)
  }

  /// Up to `len` bytes at `pos` (fewer near the end of the file).
  pub fn peek(&mut self, pos: u64, len: u64) -> Result<Vec<u8>> {
    let len = len.min(self.len.saturating_sub(pos));
    self.read_at(pos, len)
  }

  /// Feeds the bytes in `pos..end` into `hasher`, streamed (audio regions are megabytes).
  pub fn hash_into(&mut self, hasher: &mut blake3::Hasher, pos: u64, end: u64) -> Result<()> {
    if pos > end || end > self.len {
      return Err(self.malformed(format!("range {pos}..{end} lies past the end of the file")));
    }
    self.file.seek(SeekFrom::Start(pos))?;
    let mut left = end - pos;
    let mut buf = vec![0u8; 64 * 1024];
    while left > 0 {
      let n = usize::try_from(left.min(buf.len() as u64)).unwrap_or(buf.len());
      self.file.read_exact(&mut buf[..n])?;
      hasher.update(&buf[..n]);
      left -= n as u64;
    }
    Ok(())
  }

  /// blake3 of the bytes in `pos..end`.
  pub fn hash_range(&mut self, pos: u64, end: u64) -> Result<[u8; 32]> {
    let mut hasher = blake3::Hasher::new();
    self.hash_into(&mut hasher, pos, end)?;
    Ok(*hasher.finalize().as_bytes())
  }

  /// A structural problem in the file (`Error::Tag`, naming the file).
  pub fn malformed(&self, what: impl std::fmt::Display) -> Error {
    Error::Tag(format!("{}: {what}", self.path.display()))
  }
}

pub(super) fn hash(bytes: &[u8]) -> [u8; 32] {
  *blake3::hash(bytes).as_bytes()
}

/// The first `N` bytes of `b` as an array (callers check the length first).
fn array<const N: usize>(b: &[u8]) -> [u8; N] {
  let mut out = [0u8; N];
  out.copy_from_slice(&b[..N]);
  out
}

pub(super) fn be16(b: &[u8]) -> u16 {
  u16::from_be_bytes(array(b))
}

pub(super) fn be24(b: &[u8]) -> u32 {
  u32::from_be_bytes([0, b[0], b[1], b[2]])
}

pub(super) fn be32(b: &[u8]) -> u32 {
  u32::from_be_bytes(array(b))
}

pub(super) fn be64(b: &[u8]) -> u64 {
  u64::from_be_bytes(array(b))
}

pub(super) fn le32(b: &[u8]) -> u32 {
  u32::from_le_bytes(array(b))
}

/// An ID3v2 "synchsafe" integer: 4 bytes of 7 bits each.
pub(super) fn syncsafe(b: &[u8]) -> u32 {
  b[..4].iter().fold(0u32, |acc, &x| (acc << 7) | u32::from(x & 0x7f))
}
