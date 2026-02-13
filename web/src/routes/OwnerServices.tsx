// web/src/routes/OwnerServices.tsx
import { useEffect, useState, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import OwnerGate from "../components/OwnerGate";
import SEO from "../components/SEO";
import SLAPolicyModal, { SLAPolicyData } from "../components/SLAPolicyModal";
import EditServiceModal from "../components/EditServiceModal";
import AddServiceModal from "../components/AddServiceModal";
import AddServiceTemplateModal from "../components/AddServiceTemplateModal";
import AddServiceSelectionModal from "../components/AddServiceSelectionModal";
import AddDepartmentSelectionModal from "../components/AddDepartmentSelectionModal";
import AddDepartmentTemplateModal from "../components/AddDepartmentTemplateModal";
import ConfirmDialog from "../components/ConfirmDialog";
import OwnerMenuManagement from "../components/OwnerMenuManagement";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import styles from "./OwnerServices.module.css";

interface Service {
  id?: string;
  key: string;
  label: string;
  sla_minutes: number;
  department_id: string;
  active: boolean;
  template_id?: string | null;
  is_custom?: boolean;
}

interface Department {
  id: string;
  code: string;
  name: string;
  description?: string;
  is_active: boolean;
  is_new?: boolean;
  is_custom?: boolean;
  template_id?: string;
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
  const [hotelId, setHotelId] = useState<string | null>(null);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [activeTab, setActiveTab] = useState<string>("");
  const [activeSubTab, setActiveSubTab] = useState<'services' | 'menu'>('services');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [customServiceName, setCustomServiceName] = useState("");
  const [customServiceSLA, setCustomServiceSLA] = useState("");
  const [customServiceActive, setCustomServiceActive] = useState(true);
  const [showAddDepartmentSelectionModal, setShowAddDepartmentSelectionModal] = useState(false);
  const [showAddDepartmentTemplateModal, setShowAddDepartmentTemplateModal] = useState(false);

  // Department Management State
  const [editingSLADeptId, setEditingSLADeptId] = useState<string | null>(null);
  const editingDept = departments.find((d) => d.id === editingSLADeptId);

  const [editingServiceIndex, setEditingServiceIndex] = useState<number | null>(null);

  // Manage Departments Modal State
  const [showManageDepartmentsModal, setShowManageDepartmentsModal] = useState(false);
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);

  /* Smart SLA Change Detection:
     Using Record<string, string | number> to allow empty string during typing.
     This replaces Partial<SLAPolicyData> which enforced numbers. */
  const [slaChanges, setSlaChanges] = useState<Record<string, Record<string, string | number>>>({});

  // Validation: Check if there are unsaved changes AND if all changes are valid
  const hasUnsavedChanges = Object.keys(slaChanges).length > 0 || dirty;

  const hasInvalidChanges = Object.values(slaChanges).some(deptChanges =>
    Object.entries(deptChanges).some(([key, val]) => {
      // Start trigger is always valid (dropdown)
      if (key === 'sla_start_trigger') return false;
      // Empty string or negative number is invalid
      if (val === "") return true;
      if (typeof val === 'number' && val < 0) return true;
      return false;
    })
  );
  const [showAddDepartmentForm, setShowAddDepartmentForm] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [newDepartmentDescription, setNewDepartmentDescription] = useState("");
  const [showDescription, setShowDescription] = useState(false);
  const [showInactiveDepartments, setShowInactiveDepartments] = useState(true);
  const [showInactiveServices, setShowInactiveServices] = useState(true);
  const [showAddServiceForm, setShowAddServiceForm] = useState(false);
  const [showAddServiceModal, setShowAddServiceModal] = useState(false);
  const [showAddServiceTemplateModal, setShowAddServiceTemplateModal] = useState(false);
  const [showAddServiceSelectionModal, setShowAddServiceSelectionModal] = useState(false);
  const [addServiceTemplateDeptId, setAddServiceTemplateDeptId] = useState<string | null>(null);

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    showCancel?: boolean;
    variant?: 'primary' | 'danger' | 'success';
    confirmVariant?: 'primary' | 'danger' | 'success'; // Supporting both naming conventions temporarily or fix usage
    icon?: React.ReactNode;
    onConfirm: () => void;
    onCancel?: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => { },
    onCancel: () => { },
  });

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
      setHotelId(hotel.id);

      const { data: depts, error: deptsError } = await supabase
        .from("departments")
        .select(`id, code, name, is_active, sla_policies!inner (target_minutes, warn_minutes, sla_start_trigger, escalate_minutes)`)
        .eq("hotel_id", hotel.id)
        .is("sla_policies.valid_to", null)
        .order("display_order", { ascending: true });

      if (deptsError) throw deptsError;

      const transformedDepts: Department[] = (depts || []).map((d: any) => ({
        id: d.id,
        code: d.code,
        name: d.name,
        is_active: d.is_active,
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
          active: s.active ?? s.is_active ?? true,
          template_id: s.template_id,
          is_custom: s.is_custom,
        }))
      );
    } catch (err: any) {
      setError(err.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [hotelSlug, activeTab]);

  // Helper to handle SLA field changes with smart detection
  const handleSLAChange = (deptId: string, field: keyof SLAPolicyData, value: string) => {
    // 1. Get original value from department
    const dept = departments.find(d => d.id === deptId);

    // For new department temp ID, we just store whatever is typed
    if (deptId === 'new-dept-temp') {
      setSlaChanges(prev => {
        const deptChanges = { ...(prev[deptId] || {}) };
        let finalValue: string | number = value;

        if (value !== "" && field !== 'sla_start_trigger') {
          // Try parse, but keep as string if it ends with dot or is just minus (though these are positive ints)
          const parsed = parseInt(value);
          if (!isNaN(parsed)) finalValue = parsed;
        }
        // Start trigger is strictly string
        if (field === 'sla_start_trigger') finalValue = value;

        deptChanges[field] = finalValue;
        return { ...prev, [deptId]: deptChanges };
      });
      return;
    }

    // Existing Department handling
    const policy = dept?.sla_policy;
    const defaults = {
      target_minutes: 30,
      warn_minutes: 5,
      sla_start_trigger: 'ON_ASSIGN',
      escalate_minutes: 25
    };

    // @ts-ignore
    const originalValue = policy ? policy[field] : defaults[field as keyof typeof defaults];

    setSlaChanges(prev => {
      const currentDeptChanges = { ...(prev[deptId] || {}) };
      let newValue: number | string = value;

      if (field !== 'sla_start_trigger') {
        if (value === "") {
          newValue = "";
        } else {
          const parsed = parseInt(value);
          if (!isNaN(parsed)) newValue = parsed;
        }
      }

      // Smart Detection: remove if matches original
      if (newValue === originalValue) {
        delete currentDeptChanges[field];
      } else {
        currentDeptChanges[field] = newValue;
      }

      // Cleanup empty dept keys
      if (Object.keys(currentDeptChanges).length === 0) {
        const { [deptId]: _gone, ...rest } = prev;
        return rest;
      }

      return { ...prev, [deptId]: currentDeptChanges };
    });
  };

  const showAlert = (title: string, message: string, variant: 'primary' | 'danger' | 'success' = 'primary') => {
    setConfirmDialog({
      isOpen: true,
      title,
      message,
      confirmText: 'OK',
      showCancel: false,
      confirmVariant: variant,
      onConfirm: () => setConfirmDialog(prev => ({ ...prev, isOpen: false })),
      onCancel: () => setConfirmDialog(prev => ({ ...prev, isOpen: false })), // Just in case
    });
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reset sub-tab when department changes
  useEffect(() => {
    setActiveSubTab('services');
  }, [activeTab]);

  const activeServices = services.filter((s) => s.department_id === activeTab && (showInactiveServices || s.active));
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
    if (!activeTab) {
      showAlert('Department Required', "Please select a department to add the service to.", 'danger');
      return;
    }

    // Parse SLA: if empty/invalid, use department default
    const slaInput = customServiceSLA.trim();
    let sla = slaInput ? parseInt(slaInput) : NaN;

    // Fallback if NaN (empty or invalid)
    if (isNaN(sla)) {
      sla = activeDept?.sla_policy?.target_minutes || 30;
    }

    const newKey = customServiceName.toLowerCase().trim().replace(/\s+/g, "_");

    // Check for Duplicates
    const alreadyExists = services.some(s => s.key === newKey && s.department_id === activeTab);
    if (alreadyExists) {
      showAlert('Duplicate Service', "A service with this name already exists in this department!", 'danger');
      return;
    }

    setServices((prev) => [
      ...prev,
      {
        id: self.crypto.randomUUID(), // Maintain client-side ID for robust saving
        key: newKey,
        label: customServiceName,
        sla_minutes: sla,
        department_id: activeTab,
        active: customServiceActive,
        is_custom: true,
        template_id: null,
      },
    ]);

    setCustomServiceName("");
    setCustomServiceSLA("");
    setCustomServiceActive(true);
    setDirty(true);
  };

  const handleGlobalAddService = async (data: { name: string; sla: number; departmentId: string; active: boolean; isTemplate?: boolean; templateCode?: string; templateId?: string | null; isCustom?: boolean } | { services: { name: string; sla: number; departmentId: string; active: boolean; isTemplate?: boolean; templateCode?: string; templateId?: string | null; isCustom?: boolean }[] }) => {
    let servicesToAdd: { name: string; sla: number; departmentId: string; active: boolean; isTemplate?: boolean; templateCode?: string; templateId?: string | null; isCustom?: boolean }[] = [];

    if ('services' in data) {
      servicesToAdd = data.services;
    } else {
      servicesToAdd = [data];
    }

    if (!hotelId) {
      showAlert('Error', "Hotel context missing", 'danger');
      return;
    }

    const servicesToInsert: any[] = [];
    const duplicates: string[] = [];

    // Process each service
    for (const s of servicesToAdd) {
      // 1. Check for duplicates
      // Use templateCode for key if available (more reliable for templates), otherwise slugify name
      const key = s.templateCode || s.name.toLowerCase().trim().replace(/\s+/g, "_");

      const alreadyExists = services.some(existing =>
        existing.key === key && existing.department_id === s.departmentId
      ) || servicesToInsert.some(newItem => newItem.key === key && newItem.department_id === s.departmentId);

      if (alreadyExists) {
        duplicates.push(s.name);
        continue;
      }

      // 2. Resolve SLA defaults
      let finalSla = s.sla;
      if (!finalSla || finalSla <= 0) {
        const dept = departments.find(d => d.id === s.departmentId);
        finalSla = dept?.sla_policy?.target_minutes || 30;
      }

      servicesToInsert.push({
        id: self.crypto.randomUUID(),
        hotel_id: hotelId,
        department_id: s.departmentId,
        key: key,
        label: s.name,
        sla_minutes: finalSla,
        active: s.active,
        template_id: s.templateId || null,
        is_custom: s.isCustom !== undefined ? s.isCustom : (s.templateId ? false : true)
      });
    }

    if (duplicates.length > 0) {
      // If we were trying to add just one and it failed
      if (servicesToAdd.length === 1) {
        const deptName = departments.find(d => d.id === servicesToAdd[0].departmentId)?.name || 'selected department';
        showAlert('Duplicate Service', `A service with this name already exists in ${deptName}!`, 'danger');
        return;
      } else {
        // Warn about duplicates but proceed with others if any
        showAlert('Duplicate Services', `Skipped ${duplicates.length} services that already exist: ${duplicates.join(', ')}`, 'danger');
      }
    }

    if (servicesToInsert.length === 0) {
      return;
    }

    // 4. Update Local State (No DB Write)
    setServices((prev) => [...prev, ...servicesToInsert]);

    showAlert('Service Added', `Added ${servicesToInsert.length} service(s) to draft`, 'success');
    setDirty(true);

    // Navigate if needed (if single add to specific dept)
    if (servicesToAdd.length === 1 && activeTab !== servicesToAdd[0].departmentId) {
      setActiveTab(servicesToAdd[0].departmentId);
    }
  };

  const handleSaveSLAPolicy = async (policy: SLAPolicyData) => {
    if (!editingSLADeptId) return;
    try {
      // Use RPC function for historical tracking
      const { data, error } = await supabase.rpc('upsert_department_sla', {
        p_department_id: editingSLADeptId,
        p_target_minutes: policy.target_minutes,
        p_warn_minutes: policy.warn_minutes,
        p_escalate_minutes: policy.escalate_minutes,
        p_sla_start_trigger: policy.sla_start_trigger,
      });

      if (error) throw error;

      await loadData();
      await loadData();
      setEditingSLADeptId(null);
    } catch (err: any) {
      showAlert('Save Failed', `Failed to save: ${err.message}`, 'danger');
    }
  };

  const handleSave = async () => {
    if (!hotelSlug) return;
    try {
      setSaving(true);
      const { data: hotel } = await supabase.from("hotels").select("id").eq("slug", hotelSlug).single();
      if (!hotel) throw new Error("Hotel not found");

      // 1. Handle New Departments
      const newDepartments = departments.filter(d => d.is_new);
      if (newDepartments.length > 0) {
        // Insert Departments
        const { error: deptError } = await supabase
          .from("departments")
          .insert(newDepartments.map(d => ({
            id: d.id, // Use client-generated ID
            hotel_id: hotel.id,
            code: d.code,
            name: d.name,
            description: d.description || null,
            is_active: d.is_active,
            template_id: d.template_id || null,
            is_custom: !d.template_id // false if template_id exists
          })));

        if (deptError) throw deptError;

        // Insert Initial SLA Policies for New Departments
        const slaPoliciesToInsert = newDepartments.map(d => {
          // Merge defaults with any immediate edits in slaChanges
          const changes = slaChanges[d.id] || {};
          const defaults = d.sla_policy || {
            target_minutes: 30,
            warn_minutes: 5,
            escalate_minutes: 25,
            sla_start_trigger: 'ON_ASSIGN'
          };

          return {
            department_id: d.id,
            target_minutes: changes.target_minutes ?? defaults.target_minutes,
            warn_minutes: changes.warn_minutes ?? defaults.warn_minutes,
            escalate_minutes: changes.escalate_minutes ?? defaults.escalate_minutes,
            sla_start_trigger: changes.sla_start_trigger ?? defaults.sla_start_trigger,
            valid_from: new Date().toISOString(),
            is_active: true
          };
        });

        const { error: slaError } = await supabase
          .from("sla_policies")
          .insert(slaPoliciesToInsert);

        if (slaError) throw slaError;
      }

      // 2. Save all SLA changes for EXISTING departments
      // (Skip new departments since we just inserted them with mixed values)
      for (const [deptId, changes] of Object.entries(slaChanges)) {
        const dept = departments.find(d => d.id === deptId);
        if (!dept) continue;

        // Skip if it was a new department (already handled above)
        if (dept.is_new) continue;

        const slaData = {
          target_minutes: changes.target_minutes ?? dept.sla_policy?.target_minutes ?? 30,
          warn_minutes: changes.warn_minutes ?? dept.sla_policy?.warn_minutes ?? 5,
          escalate_minutes: changes.escalate_minutes ?? dept.sla_policy?.escalate_minutes ?? 25,
          sla_start_trigger: changes.sla_start_trigger ?? dept.sla_policy?.sla_start_trigger ?? 'ON_ASSIGN',
        };

        const { error } = await supabase.rpc('upsert_department_sla', {
          p_department_id: deptId,
          p_target_minutes: slaData.target_minutes,
          p_warn_minutes: slaData.warn_minutes,
          p_escalate_minutes: slaData.escalate_minutes,
          p_sla_start_trigger: slaData.sla_start_trigger,
        });

        if (error) throw error;
      }

      // 3. Save Service changes
      const invalid = services.find((s) => !s.key.trim() || !s.label.trim());
      if (invalid) {
        showAlert('Validation Error', "All services must have a key and label", 'danger');
        return;
      }

      // Upsert services
      const servicesToUpsert = services.map(s => ({
        id: s.id,
        hotel_id: hotel.id,
        department_id: s.department_id,
        key: s.key,
        label: s.label,
        sla_minutes: s.sla_minutes,
        active: s.active,
        template_id: s.template_id || null,
        // Fallback: if is_custom is missing, derive it from template_id (if template_id exists, it's NOT custom)
        is_custom: s.is_custom !== undefined ? s.is_custom : (s.template_id ? false : true)
      }));

      const { error: servicesError } = await supabase.from("services").upsert(servicesToUpsert);

      if (servicesError) throw servicesError;

      setSlaChanges({});
      setDirty(false);
      await loadData();
      showAlert('Success', "Saved settings successfully!", 'success');
    } catch (err: any) {
      showAlert('Error', `Failed: ${err.message}`, 'danger');
    } finally {
      setSaving(false);
    }
  };

  const handleRevert = () => {
    setConfirmDialog({
      isOpen: true,
      title: "Discard Changes?",
      message: "Are you sure you want to discard your unsaved changes?",
      confirmText: "Discard",
      cancelText: "Cancel",
      confirmVariant: 'danger',
      showCancel: true,
      onConfirm: () => {
        loadData();
        setDirty(false);
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
      },
      onCancel: () => setConfirmDialog(prev => ({ ...prev, isOpen: false })),
    });
  };

  const handleArchiveDepartment = async (deptId: string, deptName: string) => {
    setConfirmDialog({
      isOpen: true,
      title: `Archive "${deptName}"?`,
      message: `This department will be hidden from new ticket creation but all existing tickets and history will remain intact.\n\nYou can reactivate it later if needed.`,
      confirmText: 'Archive',
      variant: 'danger',
      icon: (
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
      ),
      onConfirm: async () => {
        setConfirmDialog({ ...confirmDialog, isOpen: false });
        try {
          setSaving(true);
          const { error } = await supabase
            .from("departments")
            .update({ is_active: false })
            .eq("id", deptId);

          if (error) throw error;

          await loadData();

          if (selectedDeptId === deptId) {
            setSelectedDeptId(null);
          }

          alert('Department archived successfully!');
        } catch (err: any) {
          alert(`Failed to archive department: ${err.message}`);
        } finally {
          setSaving(false);
        }
      }
    });
  };

  const handleReactivateDepartment = async (deptId: string, deptName: string) => {
    setConfirmDialog({
      isOpen: true,
      title: `Activate "${deptName}"?`,
      message: `This department will be available for new ticket creation again.`,
      confirmText: 'Activate',
      variant: 'success',
      icon: (
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      onConfirm: async () => {
        setConfirmDialog({ ...confirmDialog, isOpen: false });
        try {
          setSaving(true);
          const { error } = await supabase
            .from("departments")
            .update({ is_active: true })
            .eq("id", deptId);

          if (error) throw error;

          await loadData();

          alert('Department activated successfully!');
        } catch (err: any) {
          alert(`Failed to activate department: ${err.message}`);
        } finally {
          setSaving(false);
        }
      }
    });
  };

  // Helper function to generate department code from name
  const generateDepartmentCode = (name: string): string => {
    return name
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, '') // Remove special characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .substring(0, 50); // Limit length
  };


  const handleAddDepartmentFromTemplate = async (selectedTemplates: any[]) => {
    if (!hotelId) return;

    try {
      const newDepartments: Department[] = selectedTemplates.map(template => ({
        id: self.crypto.randomUUID(),
        code: template.code,
        name: template.name,
        description: template.description || undefined,
        is_active: true,
        is_new: true,
        template_id: template.id,
        sla_policy: {
          target_minutes: template.default_target_minutes,
          warn_minutes: template.default_warn_minutes,
          escalate_minutes: template.default_escalate_minutes,
          sla_start_trigger: template.default_sla_start_trigger
        }
      }));

      setDepartments(prev => [...prev, ...newDepartments]);
      setDirty(true);
      setShowAddDepartmentTemplateModal(false);

      // Auto-switch to the first new department so user sees it?
      // Optional, but might be nice. For now, let's just add it.
      if (newDepartments.length > 0 && !activeTab) {
        setActiveTab(newDepartments[0].id);
      }

    } catch (err: any) {
      console.error(err);
      alert(`Failed to add departments: ${err.message}`);
    }
  };

  const handleAddDepartment = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (!hotelSlug || !newDepartmentName.trim()) {
      alert("Please enter department name");
      return;
    }

    try {
      // Auto-generate code from name
      const generatedCode = generateDepartmentCode(newDepartmentName);

      const newDeptId = self.crypto.randomUUID();

      const newDept: Department = {
        id: newDeptId,
        code: generatedCode,
        name: newDepartmentName,
        description: newDepartmentDescription.trim() || undefined,
        is_active: true,
        is_new: true,
        is_custom: true, // Explicitly mark as custom
        template_id: undefined, // Explicitly undefined for custom
        sla_policy: {
          target_minutes: 30,
          warn_minutes: 20,
          escalate_minutes: 20,
          sla_start_trigger: 'ON_ASSIGN',
        }
      };

      setDepartments(prev => [...prev, newDept]);

      // Handle any SLA overrides from the temporary state
      if (slaChanges['new-dept-temp']) {
        setSlaChanges(prev => ({
          ...prev,
          [newDeptId]: prev['new-dept-temp']
        }));
      }

      // Reset form
      setNewDepartmentName("");
      setNewDepartmentDescription("");
      setShowDescription(false);
      setShowAddDepartmentForm(false);

      // Cleanup temp SLA state
      setSlaChanges(prev => {
        const { 'new-dept-temp': _, ...rest } = prev;
        return rest;
      });

      setDirty(true);

      // Auto-select the new department in the modal settings, but NOT the main tab
      setSelectedDeptId(newDeptId);

    } catch (err: any) {
      console.error(err);
      alert(`Failed to add department: ${err.message}`);
    }
  };



  const handleSaveManageDepartments = () => {
    if (!hotelSlug) return;

    setConfirmDialog({
      isOpen: true,
      title: "Save Changes?",
      message: "This will apply to new tickets only.\n\nExisting tickets will continue with their original SLA.",
      confirmText: "Save Changes",
      variant: 'primary',
      icon: (
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
        </svg>
      ),
      onConfirm: async () => {
        await handleSave();
        setShowManageDepartmentsModal(false);
      }
    });
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
        <div className="flex flex-col min-h-screen">
          {/* Header / Breadcrumb */}
          <header className="flex h-10 items-center border-b border-white/10 bg-[#1A2040] px-4 shadow-sm shrink-0">
            <div className="flex items-center gap-2 text-xs">
              <Link to={hotelSlug ? `/owner/${hotelSlug}` : '/owner'} className="font-medium text-slate-400 hover:text-white">
                Dashboard
              </Link>
              <span className="text-slate-600">›</span>
              <span className="font-semibold text-white">Departments/Services & SLAs</span>
            </div>
          </header>

          <div className={`flex-1 bg-gradient-to-b from-[#1A2040] via-[#0B0F1A] to-[#0B0F1A] text-white p-6 md:p-7 ${styles.mainContainer}`}>
            <div className={styles.contentWrapper}>
              {/* Header */}
              <div className={styles.pageHeader}>
                <div>
                  <h1 className={styles.pageTitle}>Services & SLAs</h1>
                  <p className={styles.pageSubtitle}>Manage guest services and response times</p>
                </div>
                <div className={styles.headerActions}>
                  <button
                    onClick={() => {
                      setSelectedDeptId(null);
                      setShowManageDepartmentsModal(true);
                    }}
                    className={styles.manageButton}
                  >
                    <svg className={styles.iconSmall} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Manage Departments & SLAs
                  </button>
                  <button
                    onClick={() => setShowAddServiceSelectionModal(true)}
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

                  {/* KITCHEN SUB-TABS */}
                  {activeDept && (activeDept.code === 'KITCHEN' || /kitchen|food|restaurant/i.test(activeDept.name)) && (
                    <div style={{ display: 'flex', gap: '24px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0' }}>
                      <button
                        onClick={() => setActiveSubTab('services')}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: '8px 4px',
                          color: activeSubTab === 'services' ? '#60A5FA' : 'rgba(255,255,255,0.6)',
                          borderBottom: activeSubTab === 'services' ? '2px solid #60A5FA' : '2px solid transparent',
                          cursor: 'pointer',
                          fontWeight: 500,
                          fontSize: '14px'
                        }}
                      >
                        Services & SLAs
                      </button>
                      <button
                        onClick={() => setActiveSubTab('menu')}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: '8px 4px',
                          color: activeSubTab === 'menu' ? '#60A5FA' : 'rgba(255,255,255,0.6)',
                          borderBottom: activeSubTab === 'menu' ? '2px solid #60A5FA' : '2px solid transparent',
                          cursor: 'pointer',
                          fontWeight: 500,
                          fontSize: '14px'
                        }}
                      >
                        Menu & Food Items
                      </button>
                    </div>
                  )}

                  {activeSubTab === 'menu' && (activeDept.code === 'KITCHEN' || /kitchen|food|restaurant/i.test(activeDept.name)) ? (
                    <div>
                      <OwnerMenuManagement hotelId={hotelId!} />
                    </div>
                  ) : (
                    /* Services Container - ONLY table with border */
                    <div className={styles.servicesContainer}>

                      {/* Section Header */}
                      <div className={styles.sectionHeader}>
                        <h2 className={styles.sectionTitle}>{activeDept?.name} Services</h2>
                        <label className={styles.showInactiveToggle}>
                          <input
                            type="checkbox"
                            checked={showInactiveServices}
                            onChange={(e) => setShowInactiveServices(e.target.checked)}
                          />
                          Show inactive
                        </label>
                      </div>

                      {/* Table Header */}
                      <div className={styles.tableHeader}>
                        <div>Key</div>
                        <div></div>
                        <div className={styles.tableHeaderCenter}>
                          <span className={styles.tooltipContainer}>
                            SLA (min)
                            <span className={styles.infoIcon}>
                              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </span>
                            <span className={styles.tooltip}>Service-level agreement: maximum response time</span>
                          </span>
                        </div>
                        <div className={styles.tableHeaderCenter}>
                          <span className={styles.tooltipContainer}>
                            Active
                            <span className={styles.infoIcon}>
                              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </span>
                            <span className={styles.tooltip}>Inactive services won't appear for new tickets</span>
                          </span>
                        </div>
                        <div></div>
                      </div>

                      {/* Service Rows */}
                      {activeServices.map((service, index) => (
                        <div key={service.id || index} className={`${styles.serviceRow} ${!service.active ? styles.inactiveService : ''}`}>
                          <div className={styles.serviceKey}>{service.key}</div>
                          <div className={styles.serviceLabelContainer}>
                            <input
                              type="text"
                              value={service.label}
                              readOnly
                              className={styles.serviceLabelInput}
                            />
                            {service.sla_minutes !== activeDept?.sla_policy?.target_minutes && (
                              <span className={styles.tooltipContainer}>
                                <span className={styles.slaOverrideIcon}>
                                  <svg fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                  </svg>
                                </span>
                                <span className={styles.tooltip}>Custom SLA: {service.sla_minutes} min (overrides department default)</span>
                              </span>
                            )}
                          </div>
                          <div className={styles.slaValue}>
                            <input
                              type="number"
                              value={service.sla_minutes}
                              disabled={!service.active}
                              onChange={(e) => {
                                const val = parseInt(e.target.value);
                                if (!isNaN(val) && val >= 0) {
                                  handleUpdateService(index, { sla_minutes: val });
                                } else if (e.target.value === '') {
                                  // Allow clearing to type new number (handle logic potentially ?) or just keep 0
                                  // For now let's set 0 or keep old? Best to allow empty string in UI state but type is number
                                  // Since binding to number, empty string might cause issue.
                                  // Let's safe guard.
                                  handleUpdateService(index, { sla_minutes: 0 });
                                }
                              }}
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
                                title={service.active ? "Deactivate service" : "Activate service (won't appear for new tickets)"}
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

                      {/* Add Service Button */}
                      {!showAddServiceForm && (
                        <div className={styles.addServicesButtonContainer}>
                          <button
                            className={styles.addServicesButton}
                            onClick={() => {
                              setAddServiceTemplateDeptId(activeDept?.id || null);
                              setShowAddServiceTemplateModal(true);
                            }}
                            style={{ marginRight: '12px' }}
                          >
                            + Add from Service Templates
                          </button>
                          <button
                            className={styles.addServicesButton}
                            onClick={() => setShowAddServiceForm(true)}
                          >
                            + Create Custom Service
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Add New Service Section */}
              {showAddServiceForm && (
                <div className={styles.addServicesSection}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 className={styles.addServicesTitle} style={{ margin: 0 }}>Add New Service</h3>
                    <button
                      onClick={() => setShowAddServiceForm(false)}
                      className={styles.cancelButton}
                      style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: '14px' }}
                    >
                      Cancel
                    </button>
                  </div>
                  <div className={styles.inlineAddServiceForm}>

                    {/* Service Name Column */}
                    <div className={styles.serviceNameColumn}>
                      <label className={styles.fieldLabel}>
                        Service Name
                      </label>
                      <input
                        id="custom-service-input"
                        type="text"
                        value={customServiceName}
                        onChange={(e) => setCustomServiceName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddCustomService()}
                        placeholder="e.g. Extra Pillow"
                        className={styles.addServicesInput}
                        style={{ width: '100%', marginBottom: 0 }}
                        autoFocus
                      />
                    </div>

                    {/* SLA Override Column */}
                    <div className={styles.slaColumn}>
                      <label className={styles.fieldLabel}>
                        SLA Override
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <input
                          type="number"
                          value={customServiceSLA}
                          onChange={(e) => setCustomServiceSLA(e.target.value)}
                          placeholder={activeDept?.sla_policy?.target_minutes?.toString() || "30"}
                          className={styles.slaOverrideInput}
                          style={{ width: '100px', marginBottom: 0, textAlign: 'center' }}
                        />
                        <span className={styles.minLabel}>min</span>
                      </div>
                      <div className={styles.helperText}>
                        Default: {activeDept?.sla_policy?.target_minutes || 30}m · Effective: <span style={{ color: '#60A5FA' }}>{customServiceSLA ? customServiceSLA : (activeDept?.sla_policy?.target_minutes || 30)}m</span>
                      </div>
                    </div>

                    {/* Active Toggle Column */}
                    <div className={styles.availabilityColumn}>
                      <label className={styles.fieldLabel}>
                        Availability
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', height: '36px', marginBottom: '4px' }}>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={customServiceActive}
                            onChange={(e) => setCustomServiceActive(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-[38px] h-[22px] bg-gray-600 peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-4 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-[18px] after:w-[18px] after:transition-all peer-checked:bg-[#4A7CFF]"></div>
                        </label>
                      </div>
                      <div className={styles.helperText}>
                        {customServiceActive ? "Available immediately" : "Starts inactive"}
                      </div>
                    </div>

                    {/* Add Button */}
                    <div className={styles.addButtonColumn}>
                      <button
                        onClick={handleAddCustomService}
                        disabled={!customServiceName.trim()}
                        className={styles.addServiceButton}
                        style={{
                          marginLeft: 'auto',
                          opacity: !customServiceName.trim() ? 0.5 : 1,
                          cursor: !customServiceName.trim() ? 'not-allowed' : 'pointer'
                        }}
                      >
                        <svg className={styles.iconSmall} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add Service
                      </button>
                    </div>
                  </div>
                </div>
              )}

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

            {/* Manage Departments Modal */}
            {showManageDepartmentsModal && (
              <div className={styles.modalBackdrop} onClick={() => {
                setShowManageDepartmentsModal(false);
                setSlaChanges({});
                setSelectedDeptId(null);
              }}>
                <div className={styles.modalContainer} onClick={(e) => e.stopPropagation()}>
                  {/* Modal Header */}
                  <div className={styles.modalHeader}>
                    <h2 className={styles.modalTitle}>Manage Departments & SLAs</h2>
                    <button
                      className={styles.modalClose}
                      onClick={() => {
                        setShowManageDepartmentsModal(false);
                        setSlaChanges({});
                        setSelectedDeptId(null);
                      }}
                    >
                      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Modal Body */}
                  <div className={styles.modalBody}>
                    {/* Department List */}
                    <div className={styles.departmentListSection}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <div className={styles.sectionLabel}>Departments</div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'rgba(255, 255, 255, 0.7)', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={showInactiveDepartments}
                            onChange={(e) => setShowInactiveDepartments(e.target.checked)}
                            style={{ cursor: 'pointer' }}
                          />
                          Show inactive
                        </label>
                      </div>

                      {departments
                        .filter(dept => showInactiveDepartments || dept.is_active)
                        .map((dept) => (
                          <div key={dept.id}>
                            <div
                              className={`${styles.departmentRow} ${selectedDeptId === dept.id ? styles.active : ''} ${!dept.is_active ? styles.inactive : ''}`}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                                <div className={styles.departmentName}>
                                  {dept.name}
                                </div>
                                {!dept.is_active && (
                                  <span className={styles.inactiveBadge}>Inactive</span>
                                )}
                              </div>

                              <div className={styles.departmentActions}>
                                <button
                                  className={`${styles.departmentSettingsButton} ${selectedDeptId === dept.id ? styles.active : ''}`}
                                  onClick={() => !dept.is_active ? null : setSelectedDeptId(selectedDeptId === dept.id ? null : dept.id)}
                                  disabled={!dept.is_active}
                                  title={!dept.is_active ? "Activate department to edit SLA settings" : "Configure SLA"}
                                >
                                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  </svg>
                                </button>
                                {dept.is_active ? (
                                  <button
                                    className={styles.departmentArchiveButton}
                                    onClick={() => handleArchiveDepartment(dept.id, dept.name)}
                                    title="Archive department (hides from new tickets, preserves history)"
                                  >
                                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                    </svg>
                                  </button>
                                ) : (
                                  <button
                                    className={styles.departmentReactivateButton}
                                    onClick={() => handleReactivateDepartment(dept.id, dept.name)}
                                    title="Activate department"
                                  >
                                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* SLA Configuration Panel */}
                            {selectedDeptId === dept.id && (
                              <div className={styles.slaConfigPanel}>
                                <div className={styles.slaConfigTitle}>SLA Configuration</div>

                                {/* Target Time */}
                                <div className={styles.slaField}>
                                  <label className={styles.slaFieldLabel}>
                                    Target Time <span style={{ color: 'red' }}>*</span>
                                    <span className={styles.tooltipContainer}>
                                      <span className={styles.infoIcon}>
                                        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                      </span>
                                      <span className={styles.tooltip}>Maximum time to complete service request</span>
                                    </span>
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    value={slaChanges[dept.id]?.target_minutes ?? dept.sla_policy?.target_minutes ?? 30}
                                    className={styles.slaFieldInput}
                                    onChange={(e) => handleSLAChange(dept.id, 'target_minutes', e.target.value)}
                                  />
                                </div>

                                {/* Warning Threshold */}
                                <div className={styles.slaField}>
                                  <label className={styles.slaFieldLabel}>
                                    Warning Threshold <span style={{ color: 'red' }}>*</span>
                                    <span className={styles.tooltipContainer}>
                                      <span className={styles.infoIcon}>
                                        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                      </span>
                                      <span className={styles.tooltip}>Time before SLA breach to show warning</span>
                                    </span>
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    value={slaChanges[dept.id]?.warn_minutes ?? dept.sla_policy?.warn_minutes ?? 5}
                                    className={styles.slaFieldInput}
                                    onChange={(e) => handleSLAChange(dept.id, 'warn_minutes', e.target.value)}
                                  />
                                </div>

                                {/* Start Trigger */}
                                <div className={styles.slaField}>
                                  <label className={styles.slaFieldLabel}>
                                    Start Trigger
                                    <span className={styles.tooltipContainer}>
                                      <span className={styles.infoIcon}>
                                        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                      </span>
                                      <span className={styles.tooltip}>When SLA timer starts counting</span>
                                    </span>
                                  </label>
                                  <select
                                    value={slaChanges[dept.id]?.sla_start_trigger ?? dept.sla_policy?.sla_start_trigger ?? 'ON_ASSIGN'}
                                    className={styles.slaFieldSelect}
                                    onChange={(e) => handleSLAChange(dept.id, 'sla_start_trigger', e.target.value)}
                                  >
                                    <option value="ON_CREATE">On Create</option>
                                    <option value="ON_ASSIGN">On Assign</option>
                                    <option value="ON_ACCEPT">On Accept</option>
                                  </select>
                                </div>

                                {/* Escalate After */}
                                <div className={styles.slaField}>
                                  <label className={styles.slaFieldLabel}>
                                    Escalate After <span style={{ color: 'red' }}>*</span>
                                    <span className={styles.tooltipContainer}>
                                      <span className={styles.infoIcon}>
                                        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                      </span>
                                      <span className={styles.tooltip}>Time before escalating to supervisor</span>
                                    </span>
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    value={slaChanges[dept.id]?.escalate_minutes ?? dept.sla_policy?.escalate_minutes ?? 25}
                                    className={styles.slaFieldInput}
                                    onChange={(e) => handleSLAChange(dept.id, 'escalate_minutes', e.target.value)}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        ))}

                      {/* Add Department Button/Form */}
                      {!showAddDepartmentForm ? (
                        <button
                          className={styles.addDepartmentButton}
                          onClick={() => setShowAddDepartmentSelectionModal(true)}
                        >
                          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          Add Department
                        </button>
                      ) : (
                        <div>
                          {/* New Department Row - Just shows it's selected */}
                          <div className={`${styles.departmentRow} ${styles.active}`}>
                            <div className={styles.departmentName}>New Department</div>
                            <div className={styles.departmentActions}>
                              <button
                                className={`${styles.departmentSettingsButton} ${styles.active}`}
                              >
                                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                              </button>
                            </div>
                          </div>

                          {/* Configuration Panel for New Department */}
                          <div className={styles.slaConfigPanel}>
                            {/* Department Details Section */}
                            <div className={styles.slaConfigTitle}>Department Details</div>

                            {/* Department Name */}
                            <div className={styles.slaField}>
                              <label className={styles.slaFieldLabel}>Department Name <span style={{ color: 'red' }}>*</span></label>
                              <input
                                type="text"
                                placeholder="e.g., Housekeeping"
                                value={newDepartmentName}
                                onChange={(e) => setNewDepartmentName(e.target.value)}
                                className={styles.slaFieldInput}
                                autoFocus
                              />
                            </div>

                            {/* Optional Description */}
                            {!showDescription ? (
                              <button
                                onClick={() => setShowDescription(true)}
                                className={styles.addDescriptionButton}
                                type="button"
                              >
                                + Add description (optional)
                              </button>
                            ) : (
                              <div className={styles.slaField}>
                                <label className={styles.slaFieldLabel}>
                                  Description (optional)
                                </label>
                                <textarea
                                  placeholder="e.g., Handles all room cleaning and linen services"
                                  value={newDepartmentDescription}
                                  onChange={(e) => setNewDepartmentDescription(e.target.value)}
                                  className={styles.descriptionTextarea}
                                  rows={2}
                                />
                              </div>
                            )}

                            {/* SLA Configuration Section */}
                            <div className={styles.slaConfigTitle} style={{ marginTop: '20px' }}>SLA Configuration</div>

                            {/* Target Time */}
                            <div className={styles.slaField}>
                              <label className={styles.slaFieldLabel}>
                                Target Time <span style={{ color: 'red' }}>*</span>
                                <span className={styles.tooltipContainer}>
                                  <span className={styles.infoIcon}>
                                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                  </span>
                                  <span className={styles.tooltip}>Maximum time to complete service request</span>
                                </span>
                              </label>
                              <input
                                type="number"
                                min="0"
                                value={slaChanges['new-dept-temp']?.target_minutes ?? 30}
                                className={styles.slaFieldInput}
                                onChange={(e) => handleSLAChange('new-dept-temp', 'target_minutes', e.target.value)}
                              />
                            </div>

                            {/* Warning Threshold */}
                            <div className={styles.slaField}>
                              <label className={styles.slaFieldLabel}>
                                Warning Threshold <span style={{ color: 'red' }}>*</span>
                                <span className={styles.tooltipContainer}>
                                  <span className={styles.infoIcon}>
                                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                  </span>
                                  <span className={styles.tooltip}>Time before SLA breach to show warning</span>
                                </span>
                              </label>
                              <input
                                type="number"
                                min="0"
                                value={slaChanges['new-dept-temp']?.warn_minutes ?? 20}
                                className={styles.slaFieldInput}
                                onChange={(e) => handleSLAChange('new-dept-temp', 'warn_minutes', e.target.value)}
                              />
                            </div>

                            {/* Start Trigger */}
                            <div className={styles.slaField}>
                              <label className={styles.slaFieldLabel}>
                                Start Trigger
                                <span className={styles.tooltipContainer}>
                                  <span className={styles.infoIcon}>
                                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                  </span>
                                  <span className={styles.tooltip}>When SLA timer starts counting</span>
                                </span>
                              </label>
                              <select
                                value={slaChanges['new-dept-temp']?.sla_start_trigger ?? 'ON_ASSIGN'}
                                className={styles.slaFieldSelect}
                                onChange={(e) => handleSLAChange('new-dept-temp', 'sla_start_trigger', e.target.value)}
                              >
                                <option value="ON_CREATE">On Create</option>
                                <option value="ON_ASSIGN">On Assign</option>
                                <option value="ON_ACCEPT">On Accept</option>
                              </select>
                            </div>

                            {/* Escalate After */}
                            <div className={styles.slaField}>
                              <label className={styles.slaFieldLabel}>
                                Escalate After <span style={{ color: 'red' }}>*</span>
                                <span className={styles.tooltipContainer}>
                                  <span className={styles.infoIcon}>
                                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                  </span>
                                  <span className={styles.tooltip}>Time before escalating to supervisor</span>
                                </span>
                              </label>
                              <input
                                type="number"
                                min="0"
                                value={slaChanges['new-dept-temp']?.escalate_minutes ?? 20}
                                className={styles.slaFieldInput}
                                onChange={(e) => handleSLAChange('new-dept-temp', 'escalate_minutes', e.target.value)}
                              />
                            </div>

                            {/* Action Buttons */}
                            <div className={styles.addDepartmentActions} style={{ marginTop: '16px' }}>
                              <button
                                onClick={() => {
                                  setShowAddDepartmentForm(false);
                                  setNewDepartmentName("");
                                  setNewDepartmentDescription("");
                                  setShowDescription(false);
                                  setSelectedDeptId(null);
                                  setSlaChanges(prev => {
                                    const { 'new-dept-temp': _, ...rest } = prev;
                                    return rest;
                                  });
                                }}
                                className={styles.cancelAddButton}
                                type="button"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={handleAddDepartment}
                                disabled={saving || !newDepartmentName.trim()}
                                className={styles.confirmAddButton}
                                type="button"
                              >
                                {saving ? 'Adding...' : 'Add Department'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Modal Footer - Hidden when adding department */}
                  {!showAddDepartmentForm && (
                    <div className={styles.modalFooter}>
                      {hasUnsavedChanges && (
                        <div className={styles.unsavedChanges}>
                          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          Unsaved changes
                        </div>
                      )}
                      <div style={{ flex: 1 }}></div>
                      <button
                        className={styles.modalCancelButton}
                        onClick={() => {
                          setShowManageDepartmentsModal(false);
                          setSlaChanges({});
                          setSelectedDeptId(null);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        className={styles.modalSaveButton}
                        onClick={handleSaveManageDepartments}
                        disabled={saving || !hasUnsavedChanges || hasInvalidChanges || (selectedDeptId ? departments.find(d => d.id === selectedDeptId)?.is_active === false : false)}
                        title={
                          selectedDeptId && departments.find(d => d.id === selectedDeptId)?.is_active === false
                            ? "Cannot save changes while department is inactive"
                            : hasInvalidChanges
                              ? "Please fix invalid values (empty or negative) before saving"
                              : !hasUnsavedChanges
                                ? "No changes to save"
                                : ""
                        }
                      >
                        {saving ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      </OwnerGate >

      {/* Custom Confirmation Dialog */}
      < ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText={confirmDialog.confirmText}
        confirmVariant={confirmDialog.variant}
        icon={confirmDialog.icon}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog({ ...confirmDialog, isOpen: false })
        }
      />
      {/* Department Selection Modal */}
      <AddDepartmentSelectionModal
        isOpen={showAddDepartmentSelectionModal}
        onClose={() => setShowAddDepartmentSelectionModal(false)}
        onSelectTemplate={() => {
          setShowAddDepartmentSelectionModal(false);
          setShowAddDepartmentTemplateModal(true);
        }}
        onSelectCustom={() => {
          setShowAddDepartmentSelectionModal(false);
          setShowAddDepartmentForm(true);
          // Create a temporary ID for the new department
          const tempId = 'new-dept-temp';
          setSelectedDeptId(tempId);
        }}
      />

      {/* Department Template Modal */}
      <AddDepartmentTemplateModal
        isOpen={showAddDepartmentTemplateModal}
        onClose={() => setShowAddDepartmentTemplateModal(false)}
        onAdd={handleAddDepartmentFromTemplate}
        existingDepartmentNames={departments.map(d => d.name)}
      />

      {/* Selection Modal */}
      <AddServiceSelectionModal
        isOpen={showAddServiceSelectionModal}
        onClose={() => setShowAddServiceSelectionModal(false)}
        onSelectTemplate={() => {
          setShowAddServiceSelectionModal(false);
          setAddServiceTemplateDeptId(null); // Global context
          setShowAddServiceTemplateModal(true);
        }}
        onSelectCustom={() => {
          setShowAddServiceSelectionModal(false);
          setShowAddServiceModal(true);
        }}
      />

      {/* Add Global Service Modal (Custom) */}
      <AddServiceModal
        isOpen={showAddServiceModal}
        departments={departments}
        initialDepartmentId={activeTab}
        onClose={() => setShowAddServiceModal(false)}
        onSave={handleGlobalAddService}
      />

      {/* Add Service From Template Modal */}
      <AddServiceTemplateModal
        isOpen={showAddServiceTemplateModal}
        departments={departments}
        initialDepartmentId={addServiceTemplateDeptId || undefined}
        existingServiceKeys={services.map(s => s.key)}
        onSave={handleGlobalAddService}
        onClose={() => setShowAddServiceTemplateModal(false)}
      />
    </>
  );
}
