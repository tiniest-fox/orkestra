List this project's live traks you may read, other than your own — those of your owner, and
those with no owner while the host has at most one user: each one's id, title, state, the
step it stands at and its goal, where it has them. Read one with `read_trak`.

`archived: true` lists the archived traks you may read instead, by title, id and title
alone; the answer says when a cap cut the list. `matching` keeps only those whose title or
id contains it, ignoring case, and needs `archived: true`. Every read tool reads an
archived trak by its id. Just after the engine starts, a trak archived before it may be
missing until the engine has read its log.
