# A sent problem report leaves no trace on the trak

A person who sends a report from a trak's page sees the receiver's reference once, on the
receipt. Nothing on the trak records that a report went or what it was filed under, so a
second person, or the same person a day later, cannot tell a report exists.

**Trigger:** someone sends a second report about a trak because they could not see the
first, or asks where a report's reference went. Settled by deciding whether a `ReportSent`
event belongs on the trak's log — which then has to stay readable forever — or whether the
host keeps the record instead.
