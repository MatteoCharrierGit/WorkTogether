package com.worktogether;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class WorkTogetherApplication {
    public static void main(String[] args) {
        SpringApplication.run(WorkTogetherApplication.class, args);
    }
}
