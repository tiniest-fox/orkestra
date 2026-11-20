{{! Sent when a response could not be decoded. Resumes the same session, so the
    agent still holds its context and only needs to reformat. On a chat turn the
    reply may be prose and an envelope both, so this asks for the envelope back
    without forbidding the words around it. }}
Your previous response could not be used: {{reason}}

Send the envelope again, corrected. Keep any prose you wrote for the person reading.
