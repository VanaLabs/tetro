-- Speech model IDs now match their Vana Labs Hugging Face repos.
UPDATE transcript_settings SET model = 'multilingual-speech-to-text' WHERE model = 'parakeet-tdt-0.6b-v3-int8';
UPDATE transcript_settings SET model = 'english-speech-to-text' WHERE model = 'parakeet-tdt-0.6b-v2-int8';
UPDATE transcript_settings SET model = 'armenian-speech-to-text' WHERE model = 'armenian-fastconformer-hy-int8';
