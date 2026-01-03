// web/src/routes/OwnerServices.tsx
import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import OwnerGate from "../components/OwnerGate";
import SEO from "../components/SEO";
import SLAPolicyModal, { SLAPolicyData } from "../components/SLAPolicyModal";
import EditServiceModal from "../components/EditServiceModal";
import { supabase } from "../lib/supabase";
import styles from "./OwnerServices.module.css";

interface Service {
  id?: string;
  key: string;
  label: string;
  sla_minutes: number;
  department_id: string;
  active: boolean;
}

interface Department {
  id: string;
  code: string;
  name: string;
  sla_policy?: {
    target_minutes: number;
    warn_minutes: number;
    sla_start_trigger: string;
    escalate_minutes: number;
  };
}

export default function OwnerServices() {
  const [searchParams] = useSearchParams();
  const hotelSlug = searchParams.get("slug");

  const [departments, setDepartments] = useState<Department[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [activeTab, setActiveTab] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [customServiceName, setCustomServiceName] = useState("");
  const [customServiceSLA, setCustomServiceSLA] = useState("");

  const [editingSLADeptId, setEditingSLADeptId] = useState<string | null>(null);
  const editingDept = departments.find((d) => d.id === editingSLADeptId);

  const [editingServiceIndex, setEditingServiceIndex] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    if (!hotelSlug) {
      setError("Hotel slug is required");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data: hotel } = await supabase.from("hotels").select("id").eq("slug", hotelSlug).single();
      if (!hotel) throw new Error("Hotel not found");

      const { data: depts, error: deptsError } = await supabase
        .from("departments")
        .select(`id, code, name, sla_policies (target_minutes, warn_minutes, sla_start_trigger, escalate_minutes)`)
        .eq("hotel_id", hotel.id)
        .eq("is_active", true)
        .order("display_order", { ascending: true });

      if (deptsError) throw deptsError;

      const transformedDepts: Department[] = (depts || []).map((d: any) => ({
        id: d.id,
        code: d.code,
        name: d.name,
        sla_policy: d.sla_policies?.[0],
      }));

      setDepartments(transformedDepts);
      if (transformedDepts.length > 0 && !activeTab) {
        setActiveTab(transformedDepts[0].id);
      }

      const { data: servicesData, error: servicesError } = await supabase
        .from("services")
        .select("*")
        .eq("hotel_id", hotel.id)
        .order("created_at", { ascending: true });

      if (servicesError) throw servicesError;

      setServices(
        (servicesData || []).map((s: any) => ({
          id: s.id,
          key: s.key,
          label: s.label || s.label_en || "",
          sla_minutes: s.sla_minutes || 30,
          department_id: s.department_id,
          active: s.active ?? true,
        }))
      );
    } catch (err: any) {
      setError(err.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [hotelSlug, activeTab]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const activeServices = services.filter((s) => s.department_id === activeTab);
  const editingService = editingServiceIndex !== null ? activeServices[editingServiceIndex] : null;
  const activeDept = departments.find((d) => d.id === activeTab);

  const handleUpdateService = (index: number, patch: Partial<Service>) => {
    const serviceId = activeServices[index].id;
    setServices((prev) => prev.map((s) => (s.id === serviceId ? { ...s, ...patch } : s)));
    setDirty(true);
  };

  const handleEditService = (name: string, sla: number) => {
    if (editingServiceIndex === null) return;
    handleUpdateService(editingServiceIndex, { label: name, sla_minutes: sla });
  };

  const handleDeleteService = async (serviceId: string) => {
    if (!confirm("Delete this service?")) return;
    try {
      const { error } = await supabase.from("services").delete().eq("id", serviceId);
      if (error) throw error;
      setServices((prev) => prev.filter((s) => s.id !== serviceId));
    } catch (err: any) {
      alert(`Failed to delete: ${err.message}`);
    }
  };

  const handleAddCustomService = () => {
    if (!customServiceName.trim()) return;
    const sla = customServiceSLA ? parseInt(customServiceSLA) : activeDept?.sla_policy?.target_minutes || 30;
    setServices((prev) => [
      ...prev,
      {
        key: customServiceName.toLowerCase().replace(/\s+/g, "_"),
        label: customServiceName,
        sla_minutes: sla,
        department_id: activeTab,
        active: true,
      },
    ]);
    setCustomServiceName("");
    setCustomServiceSLA("");
    setDirty(true);
  };

  const handleSaveSLAPolicy = async (policy: SLAPolicyData) => {
    if (!editingSLADeptId) return;
    try {
      await supabase.from("sla_policies").upsert({ department_id: editingSLADeptId, ...policy, is_active: true });
      await loadData();
    } catch (err: any) {
      alert(`Failed to save: ${err.message}`);
    }
  };

  const handleSave = async () => {
    if (!hotelSlug) return;
    try {
      setSaving(true);
      const { data: hotel } = await supabase.from("hotels").select("id").eq("slug", hotelSlug).single();
      if (!hotel) throw new Error("Hotel not found");

      const invalid = services.find((s) => !s.key.trim() || !s.label.trim());
      if (invalid) {
        alert("All services must have a key and label");
        return;
      }

      await supabase.from("services").upsert(
        services.map((s) => ({
          id: s.id,
          hotel_id: hotel.id,
          department_id: s.department_id,
          key: s.key,
          label: s.label,
          sla_minutes: s.sla_minutes,
          active: s.active,
        }))
      );

      setDirty(false);
      await loadData();
      alert("Saved successfully!");
    } catch (err: any) {
      alert(`Failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRevert = () => {
    if (confirm("Discard changes?")) {
      loadData();
      setDirty(false);
    }
  };

  const formatStartTrigger = (trigger: string) => {
    return trigger.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  };

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingText}>Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.errorText}>Error: {error}</div>
      </div>
    );
  }

  return (
    <>
      <SEO title="Services & SLAs" noIndex />
      <OwnerGate roles={["owner", "manager"]}>
        <div className={`min-h-screen bg-gradient-to-b from-[#1A2040] via-[#0B0F1A] to-[#0B0F1A] text-white p-6 md:p-7 ${styles.mainContainer}`}>
          <div className={styles.contentWrapper}>
            {/* Header */}
            <div className={styles.pageHeader}>
              <div>
                <h1 className={styles.pageTitle}>Services & SLAs</h1>
                <p className={styles.pageSubtitle}>Manage guest services and response times</p>
              </div>
              <div className={styles.headerActions}>
                <button className={styles.manageButton}>
                  <svg className={styles.iconSmall} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Manage Departments & SLAs
                </button>
                <button
                  onClick={() => document.getElementById("custom-service-input")?.focus()}
                  className={styles.manageButton}
                >
                  <svg className={styles.iconSmall} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Service
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className={styles.tabsShell}>
              {departments.map((dept) => (
                <button
                  key={dept.id}
                  onClick={() => setActiveTab(dept.id)}
                  className={`${styles.tab} ${activeTab === dept.id ? styles.active : ''}`}
                >
                  {dept.name}
                </button>
              ))}
            </div>

            {/* SLA Summary Bar - OUTSIDE bordered container */}
            {activeDept?.sla_policy && (
              <>
                <div className={styles.slaSummaryBar}>
                  <div className={styles.slaSummaryText}>
                    <span className={styles.slaSummaryLabel}>{activeDept.name.toUpperCase()}</span>
                    {" — "}
                    SLA: {activeDept.sla_policy.target_minutes} min · Starts: {formatStartTrigger(activeDept.sla_policy.sla_start_trigger)} · Escalates: +
                    {activeDept.sla_policy.escalate_minutes} min
                  </div>
                  <button
                    onClick={() => setEditingSLADeptId(activeTab)}
                    className={styles.editDepartmentButton}
                  >
                    Edit Department SLA
                  </button>
                </div>

                {/* Services Container - ONLY table with border */}
                <div className={styles.servicesContainer}>

                  {/* Section Header */}
                  <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>{activeDept?.name} Services</h2>
                  </div>

                  {/* Table Header */}
                  <div className={styles.tableHeader}>
                    <div>Key</div>
                    <div></div>
                    <div className={styles.tableHeaderCenter}>SLA (min)</div>
                    <div className={styles.tableHeaderCenter}>Active</div>
                    <div></div>
                  </div>

                  {/* Service Rows */}
                  {activeServices.map((service, index) => (
                    <div key={service.id || index} className={styles.serviceRow}>
                      <div className={styles.serviceKey}>{service.key}</div>
                      <div className={styles.serviceLabelContainer}>
                        <input
                          type="text"
                          value={service.label}
                          disabled
                          className={styles.serviceLabelInput}
                        />
                        {service.sla_minutes !== activeDept?.sla_policy?.target_minutes && (
                          <span className={styles.slaOverride}>SLA: {service.sla_minutes} min (overridden)</span>
                        )}
                      </div>
                      <div className={styles.slaValue}>
                        <input
                          type="text"
                          value={service.sla_minutes}
                          disabled
                          className={styles.slaInput}
                        />
                      </div>
                      <div className={styles.activeToggleContainer}>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={service.active}
                            onChange={(e) => handleUpdateService(index, { active: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-[38px] h-[22px] bg-gray-600 peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-4 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-[18px] after:w-[18px] after:transition-all peer-checked:bg-[#4A7CFF]"></div>
                        </label>
                      </div>
                      <div className={styles.actionButtons}>
                        <button onClick={() => setEditingServiceIndex(index)} className={`${styles.actionButton} ${styles.editButton}`}>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button onClick={() => handleDeleteService(service.id!)} className={`${styles.actionButton} ${styles.deleteButton}`}>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Add from Common Services Button */}
                  <div className={styles.addServicesButtonContainer}>
                    <button className={styles.addServicesButton}>+ Add from Common Services</button>
                  </div>
                </div>
              </>
            )}

            {/* Add from Common Services Section */}
            <div className={styles.addServicesSection}>
              <h3 className={styles.addServicesTitle}>Add from Common Services</h3>
              <div className={styles.addServicesForm}>
                <input
                  id="custom-service-input"
                  type="text"
                  value={customServiceName}
                  onChange={(e) => setCustomServiceName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddCustomService()}
                  placeholder="Service name"
                  className={styles.addServicesInput}
                />
                <input
                  type="number"
                  value={customServiceSLA}
                  onChange={(e) => setCustomServiceSLA(e.target.value)}
                  placeholder="SLA override (optional)"
                  className={styles.slaOverrideInput}
                />
                <span className={styles.minLabel}>min</span>
                <button
                  onClick={handleAddCustomService}
                  className={styles.addServiceButton}
                >
                  <svg className={styles.iconSmall} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Service
                </button>
              </div>
            </div>

            {/* Warning Banner */}
            <div className={styles.warningBanner}>
              <div className={styles.warningContent}>
                <svg className={styles.warningIcon} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div className={styles.warningTextContainer}>
                  <div className={styles.warningTitle}>Changes apply to NEW tickets only</div>
                  <div className={styles.warningDescription}>Existing tickets will continue with their original SLA</div>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className={styles.footerActions}>
              <button
                onClick={handleRevert}
                className={styles.cancelButton}
              >
                Cancel
              </button>
              <div className={styles.footerActionsRight}>
                <button className={styles.cancelButton}>
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className={styles.saveButton}
                >
                  {saving ? "Saving..." : "Save Settings"}
                </button>
              </div>
            </div>
          </div>

          {/* SLA Policy Modal */}
          {editingDept && (
            <SLAPolicyModal
              isOpen={editingSLADeptId !== null}
              departmentName={editingDept.name}
              initialPolicy={
                editingDept.sla_policy || {
                  target_minutes: 30,
                  warn_minutes: 20,
                  sla_start_trigger: "ON_ASSIGN",
                  escalate_minutes: 10,
                }
              }
              onSave={handleSaveSLAPolicy}
              onClose={() => setEditingSLADeptId(null)}
            />
          )}

          {/* Edit Service Modal */}
          {editingService && (
            <EditServiceModal
              isOpen={editingServiceIndex !== null}
              serviceName={editingService.label}
              slaMinutes={editingService.sla_minutes}
              departmentName={activeDept?.name || ""}
              onSave={handleEditService}
              onClose={() => setEditingServiceIndex(null)}
            />
          )}
        </div>
      </OwnerGate>
    </>
  );
}
