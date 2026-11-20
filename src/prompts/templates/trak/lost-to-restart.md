{{! What a call cut by an engine restart answers, once the sandbox's relay resends it to
    the engine that came back. Nothing is run again for it. `check` is set for `run_check`. }}
{{#check}}The engine restarted while this check ran, so its result was lost. Calling `run_check` again is safe: a pass the engine already recorded is kept, and the check runs again only if none was.{{/check}}
{{^check}}The engine restarted before this call was answered, so its answer was lost. The call may have run: check whether it did before calling it again.{{/check}}
