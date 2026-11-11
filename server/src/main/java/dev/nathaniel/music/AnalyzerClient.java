package dev.nathaniel.music;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

/** Forward an uploaded song to Python; persist only the analysis metadata in Java. */
@Component
public class AnalyzerClient {
    private final HttpClient client = HttpClient.newBuilder()
            // Uvicorn accepts HTTP/1.1 here; Java's HTTP/2 default sends an h2c upgrade.
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(5)).build();
    private final JsonMapper mapper;
    private final String baseUrl;

    public AnalyzerClient(@Value("${analyzer.base-url}") String baseUrl, JsonMapper mapper) {
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.mapper = mapper;
    }

    public Map<String, Object> analyze(String endpoint, MultipartFile audio) {
        Path tempFile = null;
        try {
            String original = audio.getOriginalFilename();
            String extension = original != null && original.toLowerCase().endsWith(".wav")
                    ? ".wav" : ".mp3";
            tempFile = Files.createTempFile("music-description-", extension);
            try (var input = audio.getInputStream()) {
                Files.copy(input, tempFile, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            }

            HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + endpoint + "-raw"))
                    .version(HttpClient.Version.HTTP_1_1)
                    .timeout(Duration.ofMinutes(12))
                    .header("Content-Type", "application/octet-stream")
                    .header("X-Audio-Extension", extension)
                    .POST(HttpRequest.BodyPublishers.ofFile(tempFile))
                    .build();
            HttpResponse<String> response = client.send(request,
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            int status = response.statusCode();
            if (status < 200 || status >= 300) {
                String detail = response.body();
                if (detail.length() > 700) detail = detail.substring(0, 700);
                HttpStatusCode outgoingStatus = status >= 400 && status < 500
                        ? HttpStatusCode.valueOf(status) : HttpStatus.BAD_GATEWAY;
                throw new ResponseStatusException(outgoingStatus,
                        "Python analyzer returned " + status + ": " + detail);
            }
            Map<String, Object> result = mapper.readValue(response.body(),
                    new TypeReference<Map<String, Object>>() {});
            if (result == null) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                        "Python analyzer returned an empty response.");
            }
            return new LinkedHashMap<>(result);
        } catch (ResponseStatusException ex) {
            throw ex;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Connection to Python analyzer was interrupted.", ex);
        } catch (JacksonException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Python analyzer returned invalid JSON.", ex);
        } catch (IOException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Could not transfer audio to Python analyzer: " + ex.getMessage(), ex);
        } finally {
            if (tempFile != null) {
                try {
                    Files.deleteIfExists(tempFile);
                } catch (IOException ignored) {
                    tempFile.toFile().deleteOnExit();
                }
            }
        }
    }
}
