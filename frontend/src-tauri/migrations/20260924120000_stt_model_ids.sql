-- Speech model IDs now follow stt-<source>-<language>, matching the Vana Labs Hugging Face repos.
UPDATE transcript_settings SET model = 'stt-parakeet-multilingual' WHERE model IN ('parakeet-tdt-0.6b-v3-int8', 'multilingual-speech-to-text');
UPDATE transcript_settings SET model = 'stt-parakeet-english' WHERE model IN ('parakeet-tdt-0.6b-v2-int8', 'english-speech-to-text');
UPDATE transcript_settings SET model = 'stt-fastconformer-armenian' WHERE model IN ('armenian-fastconformer-hy-int8', 'armenian-speech-to-text');
