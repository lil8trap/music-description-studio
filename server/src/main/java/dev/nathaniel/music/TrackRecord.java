package dev.nathaniel.music;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;

import java.time.Instant;
import java.util.UUID;

@Entity
public class TrackRecord {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, length = 255)
    private String filename;

    @Column(nullable = false)
    private Instant analyzedAt = Instant.now();

    private Double tempo;
    private Double duration;
    private Double energy;
    private Double brightness;
    private Double zcr;
    private Double correctedBpm;
    private String description;
    private boolean favorite;

    @Column(length = 500)
    private String notes = "";

    protected TrackRecord() {}

    public TrackRecord(String filename, Double tempo, Double duration,
                       Double energy, Double brightness, Double zcr) {
        this.filename = filename;
        this.tempo = tempo;
        this.duration = duration;
        this.energy = energy;
        this.brightness = brightness;
        this.zcr = zcr;
    }

    public UUID getId() { return id; }
    public String getFilename() { return filename; }
    public Instant getAnalyzedAt() { return analyzedAt; }
    public Double getTempo() { return tempo; }
    public Double getDuration() { return duration; }
    public Double getEnergy() { return energy; }
    public Double getBrightness() { return brightness; }
    public Double getZcr() { return zcr; }
    public Double getCorrectedBpm() { return correctedBpm; }
    public String getDescription() { return description; }
    public boolean isFavorite() { return favorite; }
    public String getNotes() { return notes; }

    public void setCorrectedBpm(Double correctedBpm) { this.correctedBpm = correctedBpm; }
    public void setDescription(String description) { this.description = description; }
    public void setFavorite(boolean favorite) { this.favorite = favorite; }
    public void setNotes(String notes) { this.notes = notes; }
}
