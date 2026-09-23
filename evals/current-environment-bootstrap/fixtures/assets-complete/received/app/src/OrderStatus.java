package com.example.ship.domain;

public enum OrderStatus {
    UNPROCESSED(0),
    PREPARING(1),
    SHIPPED(2),
    CANCELED(9);

    private final int code;

    OrderStatus(int code) {
        this.code = code;
    }

    public int getCode() {
        return code;
    }
}
