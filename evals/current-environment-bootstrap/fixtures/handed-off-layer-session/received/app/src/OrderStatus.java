package com.example.ship.domain;

public enum OrderStatus {
    S0(0),
    S1(1),
    S2(2),
    S3(3),
    S9(9);

    private final int code;

    OrderStatus(int code) {
        this.code = code;
    }

    public int getCode() {
        return code;
    }

    public static OrderStatus of(int code) {
        for (OrderStatus s : values()) {
            if (s.code == code) {
                return s;
            }
        }
        throw new IllegalArgumentException("unknown status: " + code);
    }
}
