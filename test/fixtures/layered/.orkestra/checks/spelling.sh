#!/bin/bash
# ---
# description: Nothing in the tree is spelled `teh`.
# timeout_seconds: 15
# ---

! grep -rq '\bteh\b' .
