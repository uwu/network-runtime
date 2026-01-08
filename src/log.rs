/// Simple logging module with verbose flag support
use std::sync::atomic::{AtomicBool, Ordering};

static VERBOSE: AtomicBool = AtomicBool::new(false);

pub fn set_verbose(enabled: bool) {
    VERBOSE.store(enabled, Ordering::Relaxed);
}

pub fn is_verbose() -> bool {
    VERBOSE.load(Ordering::Relaxed)
}

/// Print if verbose mode is enabled
#[macro_export]
macro_rules! vlog {
    ($($arg:tt)*) => {
        if $crate::log::is_verbose() {
            println!($($arg)*);
        }
    };
}

/// Print error if verbose mode is enabled
#[macro_export]
macro_rules! vlog_err {
    ($($arg:tt)*) => {
        if $crate::log::is_verbose() {
            eprintln!($($arg)*);
        }
    };
}

/// Always print (not affected by verbose flag)
#[macro_export]
macro_rules! alog {
    ($($arg:tt)*) => {
        println!($($arg)*);
    };
}

/// Always print error (not affected by verbose flag)
#[macro_export]
macro_rules! alog_err {
    ($($arg:tt)*) => {
        eprintln!($($arg)*);
    };
}
