# The cache checkout keeps a copy of `.orkestra/` for every default-branch commit

Under an external store, each default-branch commit the engine reads is written out under
`.orkestra/.committed/<sha>/` in the cache checkout, and nothing removes one: a script
started from a copy must never see its file go. They are small, but they grow by one per
commit the engine sees move.

**Trigger:** a cache checkout's `.orkestra/.committed/` is large enough that someone notices
it — on disk, in a backup, or in a sandbox mirror. Settled by removing every copy but the
one held, once no check, setup or process started from it is still running.
