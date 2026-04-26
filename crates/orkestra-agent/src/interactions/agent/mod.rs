//! Agent execution domain — running agents synchronously and asynchronously.

pub mod build_process_config;
pub mod classify_output;
pub mod run_async;
pub mod run_sync;

#[cfg(test)]
pub(crate) mod test_support {
    use orkestra_parser::types::ParsedUpdate;
    use orkestra_parser::{AgentParser, ExtractionResult};
    use orkestra_types::domain::LogEntry;

    pub(crate) struct MockParser {
        pub(crate) extract_result: ExtractionResult,
    }

    impl AgentParser for MockParser {
        fn parse_line(&mut self, _line: &str) -> ParsedUpdate {
            ParsedUpdate {
                log_entries: Vec::new(),
                session_id: None,
            }
        }
        fn finalize(&mut self) -> Vec<LogEntry> {
            Vec::new()
        }
        fn extract_output(&self, _full_output: &str) -> ExtractionResult {
            self.extract_result.clone()
        }
    }
}
