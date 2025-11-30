// src/pages/ServiceDetail.jsx

import React from "react";
import { useParams, Link } from "react-router-dom";
import { SERVICES } from "../data/services";

export default function ServiceDetail() {
  const { slug } = useParams();
  const service = SERVICES.find((s) => s.slug === slug);

  if (!service) {
    return (
      <section className="container section-inner">
        <h1 className="section-title">Service not found</h1>
        <p style={{ marginBottom: "1.5rem" }}>
          The service you are looking for does not exist or has been moved.
        </p>
        <Link to="/services" className="btn-outline">
          Back to all services
        </Link>
      </section>
    );
  }

  return (
    <section id="service-detail">
      <div className="container section-inner">
        <div className="section-header">
          <div>
            <div className="section-kicker">Our services</div>
            <div className="section-title">{service.title}</div>
          </div>
          <div className="section-pill">
            <Link to="/services" className="pill-link">
              ← Back to all services
            </Link>
          </div>
        </div>

        <div className="two-col">
          <div>
            <p
              style={{
                fontSize: "0.95rem",
                color: "#e5e7eb",
                marginBottom: "1.1rem",
              }}
            >
              {service.intro}
            </p>
            <ul className="service-points">
              {service.bullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <div>
            <div className="pill-list">
              <div className="pill-item">
                <strong>Who it is ideal for</strong>
                <span>
                  Most commonly used by our{" "}
                  <em>start-ups, MSMEs, family businesses and growing
                  companies</em>.
                </span>
              </div>
              <div className="pill-item">
                <strong>How we typically engage</strong>
                <span>
                  One-time set-up plus ongoing compliance support with clear
                  timelines and checklists.
                </span>
              </div>
              <div className="pill-item">
                <strong>Next step</strong>
                <span>
                  Share a brief of your requirement on the contact page and our
                  team will get in touch with a tailored scope and fee quote.
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
