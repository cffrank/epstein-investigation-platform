Grafana alerting provisioning requires specific YAML format for automated alert rule setup.

For now, import alerts manually via the Grafana UI at /grafana.

Alert rules are defined in Prometheus at config/prometheus/alert_rules.yml. Grafana connects to Prometheus as a data source and can visualize these alerts on dashboards and in the Alerting section.
