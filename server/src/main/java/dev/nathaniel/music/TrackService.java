package dev.nathaniel.music;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@Service
public class TrackService {
    private static final long MAX_BYTES = 100L * 1024 * 1024;
    private final TrackRepository repository;
    private final AnalyzerClient analyzer;

    public TrackService(TrackRepository repository, AnalyzerClient analyzer) {
        this.repository = repository;
        this.analyzer = analyzer;
    }

    public Map<String, Object> analyze(MultipartFile audio) {
        validate(audio);
        Map<String, Object> result = analyzer.analyze("/api/analyze", audio);
        TrackRecord saved = repository.save(new TrackRecord(
                safeFilename(audio.getOriginalFilename()),
                number(result.get("tempo")), number(result.get("duration")),
                number(result.get("energy")), number(result.get("brightness")),
                number(result.get("zcr"))));
        result.put("id", saved.getId().toString());
        return result;
    }

    public Map<String, Object> describe(UUID id, MultipartFile audio) {
        TrackRecord track = get(id);
        validate(audio);
        Map<String, Object> result = analyzer.analyze("/api/description", audio);
        Object description = result.get("description");
        if (description instanceof String label) {
            track.setDescription(label);
            repository.save(track);
        }
        return result;
    }

    public Map<String, Object> timeline(UUID id, MultipartFile audio) {
        get(id);
        validate(audio);
        return analyzer.analyze("/api/timeline", audio);
    }

    public List<TrackSummary> list() {
        return repository.findAllByOrderByAnalyzedAtDesc()
                .stream().map(TrackSummary::from).toList();
    }

    public TrackSummary update(UUID id, Map<String, Object> changes) {
        TrackRecord track = get(id);
        if (changes.containsKey("notes")) {
            Object value = changes.get("notes");
            if (!(value instanceof String notes) || notes.length() > 500) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Notes must contain at most 500 characters.");
            }
            track.setNotes(notes);
        }
        if (changes.containsKey("correctedBpm")) {
            Object value = changes.get("correctedBpm");
            if (value == null) {
                track.setCorrectedBpm(null);
            } else if (value instanceof Number bpm && Double.isFinite(bpm.doubleValue())
                    && bpm.doubleValue() >= 30 && bpm.doubleValue() <= 300) {
                track.setCorrectedBpm(bpm.doubleValue());
            } else {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Corrected tempo must be between 30 and 300 BPM.");
            }
        }
        if (changes.containsKey("favorite")) {
            if (!(changes.get("favorite") instanceof Boolean favorite)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Favorite must be true or false.");
            }
            track.setFavorite(favorite);
        }
        return TrackSummary.from(repository.save(track));
    }

    public void delete(UUID id) {
        TrackRecord track = get(id);
        repository.delete(track);
    }

    private TrackRecord get(UUID id) {
        return repository.findById(id).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Saved track not found."));
    }

    private static void validate(MultipartFile audio) {
        String name = safeFilename(audio.getOriginalFilename()).toLowerCase();
        if (audio.isEmpty() || !(name.endsWith(".mp3") || name.endsWith(".wav"))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose an MP3 or WAV file.");
        }
        if (audio.getSize() > MAX_BYTES) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Maximum file size is 100 MB.");
        }
    }

    private static String safeFilename(String original) {
        String name = original == null ? "" : original.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1);
        return name.length() > 255 ? name.substring(name.length() - 255) : name;
    }

    private static Double number(Object value) {
        return value instanceof Number n && Double.isFinite(n.doubleValue()) ? n.doubleValue() : null;
    }

    public record TrackSummary(UUID id, String filename, java.time.Instant analyzedAt,
                               Double tempo, Double duration, Double energy, Double brightness,
                               Double zcr, Double correctedBpm, String description,
                               boolean favorite, String notes) {
        static TrackSummary from(TrackRecord record) {
            return new TrackSummary(record.getId(), record.getFilename(), record.getAnalyzedAt(),
                    record.getTempo(), record.getDuration(), record.getEnergy(), record.getBrightness(),
                    record.getZcr(), record.getCorrectedBpm(), record.getDescription(),
                    record.isFavorite(), record.getNotes());
        }
    }
}
