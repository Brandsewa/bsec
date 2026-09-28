-- Function to generate UUIDv7 (RFC 9562) natively in PostgreSQL without external extensions
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
DECLARE
  v_time timestamp with time zone := clock_timestamp();
  v_epoch_ms bigint;
  v_bytes bytea;
BEGIN
  v_epoch_ms := (extract(epoch from v_time) * 1000)::bigint;
  v_bytes := substring(int8send(v_epoch_ms) from 3 for 6) || substring(uuid_send(gen_random_uuid()) from 7 for 10);
  v_bytes := set_byte(v_bytes, 6, (get_byte(v_bytes, 6) & 15) | 112);
  v_bytes := set_byte(v_bytes, 8, (get_byte(v_bytes, 8) & 63) | 128);
  RETURN encode(v_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;
