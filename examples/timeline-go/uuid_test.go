package timeline

import (
    "testing"
    "github.com/google/uuid"
    "github.com/google/go-cmp/cmp"
)

func TestParseUUID(t *testing.T) {
    id, err := uuid.Parse("550e8400-e29b-41d4-a716-446655440000")
    if err != nil || id.String() != "550e8400-e29b-41d4-a716-446655440000" {
        t.Fatalf("UUID parsing failed: %v", err)
    }
    if !cmp.Equal(id.String(), "550e8400-e29b-41d4-a716-446655440000") {
        t.Fatal("UUID mismatch")
    }
}
