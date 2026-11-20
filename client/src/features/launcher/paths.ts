/**
 * Where a path is cut for the row's middle ellipsis: everything before its last two
 * segments, and those two. The head shrinks and takes the ellipsis; the tail never
 * leaves — so two folders both named `client` stay apart by their parents, which is the
 * one thing the folder name alone cannot do. Width-adaptive rather than a character
 * budget, which would be wrong at both 380px and 1000px.
 *
 * Kind `pure`: a string in, two strings out.
 */
export const splitTail = (text: string): readonly [head: string, tail: string] => {
  const last = text.lastIndexOf("/")
  const cut = last <= 0 ? -1 : text.lastIndexOf("/", last - 1)
  return cut <= 0 ? ["", text] : [text.slice(0, cut), text.slice(cut)]
}
