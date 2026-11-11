package dev.nathaniel.music;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@SpringBootApplication
public class MusicDescriptionApplication {
    public static void main(String[] args) {
        SpringApplication.run(MusicDescriptionApplication.class, args);
    }

    @Bean
    WebMvcConfigurer localFrontendCors() {
        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                registry.addMapping("/api/**")
                        .allowedOrigins("http://127.0.0.1:5173", "http://localhost:5173")
                        .allowedMethods("GET", "POST", "PATCH", "DELETE");
            }
        };
    }
}
