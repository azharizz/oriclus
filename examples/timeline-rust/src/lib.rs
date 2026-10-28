use serde::Serialize;

#[derive(Serialize)]
pub struct Message {
    pub value: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_message() {
        assert_eq!(serde_json::to_string(&Message { value: 3 }).unwrap(), "{\"value\":3}");
    }
}
