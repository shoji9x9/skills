package com.example.ship.validation;

public class CustomerValidator {

    private static final String RANK_PATTERN = "^[ABCS]$";

    public boolean isValidRank(String rankCode) {
        return rankCode != null && rankCode.matches(RANK_PATTERN);
    }
}
