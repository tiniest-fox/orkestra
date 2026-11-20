#!/bin/bash
# ---
# description: Nothing in the tree is spelled `teh`, checked the local way.
# timeout_seconds: 5
# ---

! grep -rq '\bteh\b' .
