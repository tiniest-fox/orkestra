{{! Resuming the composer because a human typed something — a question about the
    plan, or the plan sent back. It still holds the whole request in its session,
    so this carries only what is new, and the message goes through as written,
    with nothing around it, for the reasons in step-message.md.

    One thing may follow it: what a landed child sent back handed up while the
    session was open, which this run spends whether or not it was shown. It renders
    as nothing on most turns, and where it renders it restates in words the signal
    the bareness carried — see handed-up.md. }}
{{message}}
{{> attached}}

{{> handed-up}}
