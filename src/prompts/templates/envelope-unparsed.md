{{! Why a response was re-asked when the block it ends on looks written as an envelope
    and is not valid JSON. It becomes the `reason` of `elicit-retry`, so it says what
    is wrong and leaves asking for the envelope again to that template. }}
the JSON block at the end of your response does not parse, so none of it was read: {{error}}. Positions count from the start of that block. If that block was not meant as your envelope, answer again without it.
