package com.example.ship.service;

import com.example.ship.domain.OrderStatus;

public class OrderService {

    public void advance(long orderId, int nextCode) {
        OrderStatus next = OrderStatus.of(nextCode);
        // 遷移可否は order_flow.properties の定義に従う
        if (!flow.allows(current(orderId), next)) {
            throw new IllegalStateException("invalid transition");
        }
        repository.updateStatus(orderId, next);
    }
}
