-- Runs once, on the first start of an empty volume (postgres image entrypoint).
-- The test database lives next to the main one (technical spec §3.3 step 7, §11).
CREATE DATABASE wrs_test;
