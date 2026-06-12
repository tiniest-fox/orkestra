//! Validate mermaid blocks in a PR body and attempt agent-driven fixes.

use crate::pr_description::PrDescriptionGenerator;
use crate::workflow::integration::mermaid_validation;

/// Validate mermaid in `body`. On failure, call `fix_pr_description` up to
/// `max_retries` times. Returns the validated/fixed body, or the ORIGINAL
/// body if all retries are exhausted.
pub(crate) fn execute(
    body: &str,
    task_title: &str,
    pr_desc_gen: &dyn PrDescriptionGenerator,
    max_retries: u32,
) -> String {
    // Fast path: no mermaid issues.
    let errors = match mermaid_validation::validate_mermaid_in_markdown(body) {
        Ok(()) => return body.to_string(),
        Err(errors) => errors,
    };

    let original_body = body.to_string();
    let mut current_body = original_body.clone();
    let mut current_errors: Vec<String> = errors.iter().map(ToString::to_string).collect();

    for _attempt in 0..max_retries {
        match pr_desc_gen.fix_pr_description(task_title, &current_body, &current_errors) {
            Ok(fixed) => match mermaid_validation::validate_mermaid_in_markdown(&fixed) {
                Ok(()) => return fixed,
                Err(new_errors) => {
                    current_body = fixed;
                    current_errors = new_errors.iter().map(ToString::to_string).collect();
                }
            },
            Err(_) => break, // Fix agent failed — stop retrying.
        }
    }

    // Exhausted: ship the original body, not the last failed attempt.
    original_body
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use orkestra_utility::pr_description::mock::MockPrDescriptionGenerator;

    use super::*;

    const BROKEN_MERMAID: &str =
        "## Summary\n\n```mermaid\ngraph TD\n  A[broken (parens)] --> B\n```\n";
    const CLEAN_BODY: &str = "## Summary\n\n- No mermaid here.\n";
    const VALID_MERMAID_BODY: &str =
        "## Summary\n\n```mermaid\ngraph TD\n  A[\"fixed\"] --> B\n```\n";

    #[test]
    fn clean_body_passes_through() {
        let gen = MockPrDescriptionGenerator::succeeding();
        let result = execute(CLEAN_BODY, "title", &gen, 3);
        assert_eq!(result, CLEAN_BODY);
        assert_eq!(
            gen.fix_call_count(),
            0,
            "fix should not be called for clean body"
        );
    }

    #[test]
    fn fix_succeeds_on_first_retry() {
        let gen = MockPrDescriptionGenerator::succeeding()
            .push_fix_response(Ok(VALID_MERMAID_BODY.to_string()));
        let result = execute(BROKEN_MERMAID, "title", &gen, 3);
        assert_eq!(result, VALID_MERMAID_BODY);
        assert_eq!(gen.fix_call_count(), 1);
    }

    #[test]
    fn fix_succeeds_on_third_retry() {
        // First two attempts return bodies that still have broken mermaid.
        let still_broken =
            "## Summary\n\n```mermaid\ngraph TD\n  A[still (broken)] --> B\n```\n".to_string();
        let gen = MockPrDescriptionGenerator::succeeding()
            .push_fix_response(Ok(still_broken.clone()))
            .push_fix_response(Ok(still_broken))
            .push_fix_response(Ok(VALID_MERMAID_BODY.to_string()));
        let result = execute(BROKEN_MERMAID, "title", &gen, 3);
        assert_eq!(result, VALID_MERMAID_BODY);
        assert_eq!(gen.fix_call_count(), 3);
    }

    #[test]
    fn exhausted_retries_return_original() {
        let still_broken =
            "## Summary\n\n```mermaid\ngraph TD\n  A[still (broken)] --> B\n```\n".to_string();
        let gen = MockPrDescriptionGenerator::succeeding()
            .push_fix_response(Ok(still_broken.clone()))
            .push_fix_response(Ok(still_broken.clone()))
            .push_fix_response(Ok(still_broken));
        let result = execute(BROKEN_MERMAID, "title", &gen, 3);
        // Must return the ORIGINAL body, not the last mutated attempt.
        assert_eq!(result, BROKEN_MERMAID);
        assert_eq!(gen.fix_call_count(), 3);
    }

    #[test]
    fn fix_agent_error_returns_original() {
        let gen = MockPrDescriptionGenerator::succeeding()
            .push_fix_response(Err("agent timeout".to_string()));
        let result = execute(BROKEN_MERMAID, "title", &gen, 3);
        assert_eq!(result, BROKEN_MERMAID);
        assert_eq!(gen.fix_call_count(), 1, "should stop after first error");
    }

    #[test]
    fn fix_receives_validation_error_text() {
        let gen = MockPrDescriptionGenerator::succeeding()
            .push_fix_response(Ok(VALID_MERMAID_BODY.to_string()));
        execute(BROKEN_MERMAID, "title", &gen, 3);

        let received_errors = gen.fix_received_errors();
        assert_eq!(received_errors.len(), 1, "should have one fix call");
        let errors = &received_errors[0];
        assert!(
            !errors.is_empty(),
            "should pass at least one error to fix agent"
        );
        assert!(
            errors[0].contains("unquoted special characters"),
            "error should describe the validation issue, got: {:?}",
            errors[0]
        );

        let received_bodies = gen.fix_received_bodies();
        assert_eq!(
            received_bodies[0], BROKEN_MERMAID,
            "should pass the broken body"
        );
    }
}
