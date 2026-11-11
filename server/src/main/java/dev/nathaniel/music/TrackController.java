package dev.nathaniel.music;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/tracks")
public class TrackController {
    private final TrackService service;

    public TrackController(TrackService service) {
        this.service = service;
    }

    @PostMapping(value = "/analyze", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> analyze(@RequestParam("audio") MultipartFile audio) {
        return service.analyze(audio);
    }

    @GetMapping
    public List<TrackService.TrackSummary> list() {
        return service.list();
    }

    @PatchMapping("/{id}")
    public TrackService.TrackSummary update(@PathVariable UUID id, @RequestBody Map<String, Object> changes) {
        return service.update(id, changes);
    }

    @PostMapping(value = "/{id}/description", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> describe(@PathVariable UUID id, @RequestParam("audio") MultipartFile audio) {
        return service.describe(id, audio);
    }

    @PostMapping(value = "/{id}/timeline", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> timeline(@PathVariable UUID id, @RequestParam("audio") MultipartFile audio) {
        return service.timeline(id, audio);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        service.delete(id);
    }
}
