package dev.nathaniel.music;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface TrackRepository extends JpaRepository<TrackRecord, UUID> {
    List<TrackRecord> findAllByOrderByAnalyzedAtDesc();
}
