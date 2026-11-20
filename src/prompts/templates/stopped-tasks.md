{{! Appended to whichever body a session is sent next after a turn of its own filed
    with background work still running. Filing stopped that work, and the provider
    told the agent nothing: the stop lands after the turn's last word. So this is the
    only place the session learns of it, and it is said once.

    It follows the body rather than opening it, so a person's message is still the
    first thing in the prompt it was typed into. The first line says who is
    speaking for the same reason — on that turn everything above it is the
    person's.

    General words only. This ships to every project and every provider: no tool
    name, and nothing about how the work was stopped. }}
## From Orkestra: background work your last filing stopped

You filed while these were still running. Filing ended that turn, so they were
stopped, and nothing they would have reported was read:

{{#stopped}}
- {{name}}
{{/stopped}}

Start again any you still need, and wait for it to finish before you file.
