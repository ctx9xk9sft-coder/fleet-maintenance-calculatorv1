import vinDatabase from "../data/vin_database.json";
import engineCodesDb from "../data/engine_codes.json";
import gearboxCodesDb from "../data/gearbox_codes.json";

function decodeVin(vin) {
  const db = vinDatabase;

  const result = {
    vin: vin || "",
    valid: true,
    supported: true,
    reason: null,
    validation_errors: [],

    wmi: {
      code: null,
      manufacturer: null,
      country_hint: null,
    },

    model_info: {
      raw_code: null,
      resolved_ruleset: null,
      name: null,
      generation: null,
    },

    body: {
      code: null,
      style: null,
      normalized_style: null,
      steering: null,
      drivetrain: null,
    },

    engine: {
      code: null,
      description: null,
      fuel_type: null,
      displacement_l: null,
      power_kw: [],
      power_kw_display: null,
    },

    restraint_system: {
      code: null,
      description: null,
    },

    model_year: {
      code: null,
      year: null,
    },

    plant: {
      code: null,
      name: null,
    },

    serial_number: null,

    special_flags: {
      n1: false,
      motorsport: false,
      ambiguous_model: false,
    },

    confidence: "high",
    warnings: [],
    possible_matches: [],

    vin_summary: {
      manufacturer: null,
      country_hint: null,
      model: null,
      generation: null,
      body_style: null,
      steering: null,
      drivetrain: null,
      fuel_type: null,
      power_kw: null,
      model_year: null,
      plant: null,
    },

    vin_codes: {
      wmi: null,
      body_code: null,
      engine_code: null,
      restraint_code: null,
      model_code: null,
      year_code: null,
      plant_code: null,
      serial_number: null,
    },

    enrichment: {
      possibleEngineCodes: [],
      engineCandidates: [],
      possibleGearboxCodes: [],
      gearboxTechCandidates: [],
      engineSource: "not_enriched",
      gearboxSource: "not_enriched",
    },

    // UI kompatibilnost
    marka: "Skoda",
    model: null,
    motorKod: null,
    motor: null,
    menjac: null,
    menjacSource: "inferred",
    modelYear: null,
    drivetrain: null,
    gearboxCode: "N/A",
    gearboxCodeSource: "not_available_from_vin",
    fuelType: null,
    oilCapacity: "N/A",
    oilSpec: "N/A",
    oilSae: "N/A",
    hourlyRate: 5500,
    candidates: [],
  };

  if (typeof vin !== "string") {
    result.valid = false;
    result.supported = false;
    result.validation_errors.push("VIN must be a string.");
    result.reason = "VIN mora biti tekst.";
    result.confidence = "low";
    return result;
  }

  const cleanVin = vin.trim().toUpperCase();
  result.vin = cleanVin;

  if (cleanVin.length !== 17) {
    result.valid = false;
    result.supported = false;
    result.validation_errors.push("VIN must be exactly 17 characters long.");
  }

  if (/[^A-HJ-NPR-Z0-9]/.test(cleanVin)) {
    result.valid = false;
    result.supported = false;
    result.validation_errors.push("VIN contains invalid characters.");
  }

  if (!result.valid) {
    result.confidence = "low";
    result.reason =
      result.validation_errors.join(", ") || "VIN nije podržan";
    return result;
  }

  const wmi = cleanVin.slice(0, 3);
  const bodyCode = cleanVin[3];
  const engineCode = cleanVin[4];
  const airbagCode = cleanVin[5];
  const modelCode = cleanVin.slice(6, 8);
  const yearCode = cleanVin[9];
  const plantCode = cleanVin[10];
  const serialNumber = cleanVin.slice(11, 17);

  result.wmi.code = wmi;
  result.body.code = bodyCode;
  result.engine.code = engineCode;
  result.restraint_system.code = airbagCode;
  result.model_info.raw_code = modelCode;
  result.model_year.code = yearCode;
  result.plant.code = plantCode;
  result.serial_number = serialNumber;

  result.vin_codes.wmi = wmi;
  result.vin_codes.body_code = bodyCode;
  result.vin_codes.engine_code = engineCode;
  result.vin_codes.restraint_code = airbagCode;
  result.vin_codes.model_code = modelCode;
  result.vin_codes.year_code = yearCode;
  result.vin_codes.plant_code = plantCode;
  result.vin_codes.serial_number = serialNumber;

  result.wmi.manufacturer = resolveManufacturer(wmi);
  result.wmi.country_hint = resolveCountryHint(wmi);

  const resolvedModelId = resolveModelRuleset(modelCode, bodyCode, db, result);

  if (!resolvedModelId) {
    result.valid = false;
    result.supported = false;
    result.validation_errors.push(`Unknown or unresolved model code: ${modelCode}`);
    result.reason = "VIN nije podržan za trenutni dekoder.";
    result.confidence = "low";
    return result;
  }

  const modelRules = db.models[resolvedModelId];

  if (!modelRules) {
    result.valid = false;
    result.supported = false;
    result.validation_errors.push(`Ruleset not found: ${resolvedModelId}`);
    result.reason = "Nedostaju pravila za dekodiranje vozila.";
    result.confidence = "low";
    return result;
  }

  result.model_info.resolved_ruleset = resolvedModelId;
  result.model_info.name = modelRules.name;
  result.model_info.generation = modelRules.generation;

  if (!modelRules.supported_wmi.includes(wmi)) {
    result.warnings.push(`WMI ${wmi} is not listed for ruleset ${resolvedModelId}.`);
    downgradeConfidence(result, "medium");
  }

  const bodyData = modelRules.body_map[bodyCode];
  if (bodyData) {
    result.body.style = bodyData.style ?? null;
    result.body.normalized_style =
      db.normalization?.body_styles?.[bodyData.style] ?? null;
    result.body.steering = bodyData.steering ?? null;
    result.body.drivetrain =
      bodyData.drivetrain
        ? db.normalization?.drivetrain?.[bodyData.drivetrain] ?? bodyData.drivetrain
        : null;

    if (bodyData.special_flags?.n1) {
      result.special_flags.n1 = true;
    }

    if (bodyData.special_flags?.motorsport) {
      result.special_flags.motorsport = true;
    }
  } else {
    result.warnings.push(`Unknown body code '${bodyCode}' for ruleset ${resolvedModelId}.`);
    downgradeConfidence(result, "medium");
  }

  const engineData = modelRules.engine_map[engineCode];
  if (engineData) {
    result.engine.description = engineData.description ?? null;
    result.engine.fuel_type = engineData.fuel_type ?? null;
    result.engine.displacement_l = engineData.displacement_l ?? null;
    result.engine.power_kw = Array.isArray(engineData.power_kw) ? engineData.power_kw : [];
    result.engine.power_kw_display = result.engine.power_kw.join("/") || null;

    if (engineData.special_flags?.motorsport) {
      result.special_flags.motorsport = true;
    }

    if (result.engine.power_kw.length > 1) {
      result.warnings.push("Engine code maps to multiple possible power outputs.");
      downgradeConfidence(result, "medium");
    }
  } else {
    result.warnings.push(`Unknown engine code '${engineCode}' for ruleset ${resolvedModelId}.`);
    downgradeConfidence(result, "medium");
  }

  const restraintData = modelRules.airbag_map[airbagCode];
  if (restraintData) {
    result.restraint_system.description = restraintData;
  } else {
    result.warnings.push(`Unknown restraint/airbag code '${airbagCode}' for ruleset ${resolvedModelId}.`);
    downgradeConfidence(result, "medium");
  }

  const year = modelRules.year_map[yearCode];
  if (year) {
    result.model_year.year = year;
  } else {
    result.warnings.push(`Unknown model year code '${yearCode}' for ruleset ${resolvedModelId}.`);
    downgradeConfidence(result, "medium");
  }

  const plant = modelRules.plant_map[plantCode];
  if (plant) {
    result.plant.name = plant;
  } else {
    result.warnings.push(`Unknown plant code '${plantCode}' for ruleset ${resolvedModelId}.`);
    downgradeConfidence(result, "medium");
  }

  // Summary
  result.vin_summary.manufacturer = result.wmi.manufacturer;
  result.vin_summary.country_hint = result.wmi.country_hint;
  result.vin_summary.model = result.model_info.name;
  result.vin_summary.generation = result.model_info.generation;
  result.vin_summary.body_style = result.body.style;
  result.vin_summary.steering = result.body.steering;
  result.vin_summary.drivetrain = result.body.drivetrain;
  result.vin_summary.fuel_type = normalizeFuelLabel(result.engine.fuel_type);
  result.vin_summary.power_kw = result.engine.power_kw_display || null;
  result.vin_summary.model_year = result.model_year.year;
  result.vin_summary.plant = result.plant.name;

  // Enrichment layer
  enrichWithEngineCodes(result);
  enrichWithGearboxCodes(result);

  // UI kompatibilnost
  result.marka = "Skoda";
  result.model = [result.model_info.name, result.model_info.generation].filter(Boolean).join(" ");
  result.motorKod =
    result.enrichment.possibleEngineCodes.length === 1
      ? result.enrichment.possibleEngineCodes[0]
      : (result.engine.code || "N/A");
  result.motor = buildUiEngineLabel(result);
  result.menjac = inferGearbox(result);
  result.modelYear = result.model_year.year || null;
  result.drivetrain = result.body.drivetrain || "N/A";
  result.fuelType = normalizeFuelLabel(result.engine.fuel_type);
  result.candidates = result.possible_matches || [];

  if (result.enrichment.possibleGearboxCodes.length > 0) {
    result.gearboxCode = result.enrichment.possibleGearboxCodes.join(", ");
    result.gearboxCodeSource = "enriched_from_model_year_profile";
  }

  applyOilDataToUi(result);

  result.reason = result.valid
    ? null
    : (result.validation_errors.join(", ") || "VIN nije podržan");

  return result;
}

function enrichWithEngineCodes(result) {
  const modelKey = toEnrichmentModelKey(result.model_info.name);
  if (!modelKey) {
    return;
  }

  const engines = engineCodesDb?.engines || {};
  const modelYear = result.model_year?.year || null;
  const displacement = result.engine?.displacement_l ?? null;
  const fuelType = result.engine?.fuel_type ?? null;
  const powers = Array.isArray(result.engine?.power_kw) ? result.engine.power_kw : [];

  const candidates = Object.values(engines)
    .filter((item) => isEngineCandidateCompatible(item, modelKey, modelYear, fuelType, displacement, powers))
    .map((item) => ({
      ...item,
      matchedApplications: filterMatchingApplications(item, modelKey, modelYear),
    }));

  result.enrichment.engineCandidates = candidates;
  result.enrichment.possibleEngineCodes = unique(candidates.map((item) => item.code));
  result.enrichment.engineSource =
    result.enrichment.possibleEngineCodes.length > 0
      ? "enriched_from_engine_master"
      : "not_enriched";

  if (result.enrichment.possibleEngineCodes.length > 1) {
    result.warnings.push("Multiple possible ETKA engine codes matched the VIN profile.");
    downgradeConfidence(result, "medium");
  }

  if (result.enrichment.possibleEngineCodes.length === 0) {
    return;
  }

  const commonOil = getCommonOilData(candidates);
  if (commonOil.capacity_l !== null) {
    result.oilCapacity = `${commonOil.capacity_l} L`;
  }
  if (commonOil.spec) {
    result.oilSpec = commonOil.spec;
  }
  if (commonOil.viscosity) {
    result.oilSae = commonOil.viscosity;
  }

  if (result.enrichment.possibleEngineCodes.length === 1) {
    const selected = candidates[0];

    if (!result.engine.description && selected.notes) {
      result.engine.description = selected.notes;
    }

    if (!result.engine.fuel_type && selected.fuel_type) {
      result.engine.fuel_type = selected.fuel_type;
    }

    if (result.engine.displacement_l == null && selected.displacement_l != null) {
      result.engine.displacement_l = selected.displacement_l;
    }

    if ((!result.engine.power_kw || result.engine.power_kw.length === 0) && selected.kw != null) {
      result.engine.power_kw = [selected.kw];
      result.engine.power_kw_display = String(selected.kw);
    }

    result.enrichment.selectedEngine = selected;
  }
}

function enrichWithGearboxCodes(result) {
  const modelKey = toEnrichmentModelKey(result.model_info.name);
  if (!modelKey) {
    return;
  }

  const candidates = gearboxCodesDb?.models?.[modelKey] || [];
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return;
  }

  const modelYear = result.model_year?.year || null;
  const inferredGearbox = inferGearbox(result);
  const allowedTech = mapInferredGearboxToTechCandidates(inferredGearbox);

  const filtered = candidates.filter((item) => {
    if (modelYear && !isYearCompatible(modelYear, item.mounting)) return false;
    if (allowedTech.length > 0 && !allowedTech.includes(item.tech_info)) return false;
    return true;
  });

  result.enrichment.possibleGearboxCodes = unique(filtered.map((item) => item.code));
  result.enrichment.gearboxTechCandidates = unique(filtered.map((item) => item.tech_info));
  result.enrichment.gearboxSource =
    result.enrichment.possibleGearboxCodes.length > 0
      ? "enriched_from_model_year_inferred_gearbox"
      : "not_enriched";

  if (result.enrichment.possibleGearboxCodes.length > 1) {
    result.warnings.push("Multiple possible gearbox codes matched the VIN profile.");
    downgradeConfidence(result, "medium");
  }
}

function isEngineCandidateCompatible(item, modelKey, modelYear, fuelType, displacement, powers) {
  if (!item) return false;

  const matchesModel =
    Array.isArray(item.models) && item.models.includes(modelKey);

  const matchesApplication = filterMatchingApplications(item, modelKey, modelYear).length > 0;

  if (!matchesModel && !matchesApplication) {
    return false;
  }

  if (fuelType && item.fuel_type && !isFuelCompatible(item.fuel_type, fuelType)) {
    return false;
  }

  if (displacement !== null && item.displacement_l != null && Number(item.displacement_l) !== Number(displacement)) {
    return false;
  }

  if (powers.length > 0 && item.kw != null && !powers.includes(item.kw)) {
    return false;
  }

  return true;
}

function filterMatchingApplications(item, modelKey, modelYear) {
  const applications = Array.isArray(item?.applications) ? item.applications : [];

  return applications.filter((app) => {
    if (modelKey && app.model !== modelKey) return false;
    if (modelYear && !isYearCompatible(modelYear, { start: app.start, end: app.end })) return false;
    return true;
  });
}

function getCommonOilData(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return {
      capacity_l: null,
      spec: null,
      viscosity: null,
    };
  }

  const capacities = unique(candidates.map((item) => item.oil_capacity_l));
  const specs = unique(candidates.map((item) => item.oil_spec));
  const viscosities = unique(candidates.map((item) => item.oil_viscosity));

  return {
    capacity_l: capacities.length === 1 ? capacities[0] : null,
    spec: specs.length === 1 ? specs[0] : null,
    viscosity: viscosities.length === 1 ? viscosities[0] : null,
  };
}

function applyOilDataToUi(result) {
  const selected = result.enrichment?.selectedEngine;

  if (selected) {
    if (selected.oil_capacity_l != null) {
      result.oilCapacity = `${selected.oil_capacity_l} L`;
    }
    if (selected.oil_spec) {
      result.oilSpec = selected.oil_spec;
    }
    if (selected.oil_viscosity) {
      result.oilSae = selected.oil_viscosity;
    }
    return;
  }

  const commonOil = getCommonOilData(result.enrichment?.engineCandidates || []);

  if (commonOil.capacity_l != null) {
    result.oilCapacity = `${commonOil.capacity_l} L`;
  }
  if (commonOil.spec) {
    result.oilSpec = commonOil.spec;
  }
  if (commonOil.viscosity) {
    result.oilSae = commonOil.viscosity;
  }
}

function buildUiEngineLabel(result) {
  const selected = result.enrichment?.selectedEngine;

  if (selected) {
    const parts = [];

    if (selected.displacement_l != null) {
      parts.push(`${selected.displacement_l.toFixed(1)}`);
    }

    if (selected.notes) {
      parts.push(selected.notes);
    } else if (selected.fuel_type) {
      parts.push(normalizeFuelLabel(selected.fuel_type));
    }

    if (selected.kw != null) {
      parts.push(`${selected.kw} kW`);
    }

    return parts.join(" ").trim() || result.engine.description || "N/A";
  }

  return result.engine.description || "N/A";
}

function isFuelCompatible(candidateFuel, vinFuel) {
  if (candidateFuel === vinFuel) return true;

  const groups = {
    hybrid: ["hybrid", "phev", "petrol_hybrid"],
    phev: ["phev", "petrol_hybrid", "hybrid"],
    petrol_hybrid: ["petrol_hybrid", "hybrid", "phev"],
  };

  return groups[candidateFuel]?.includes(vinFuel) || groups[vinFuel]?.includes(candidateFuel) || false;
}

function resolveModelRuleset(modelCode, bodyCode, db, result) {
  const candidates = db?.resolver?.by_model_code?.[modelCode];

  if (!candidates || candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  const disambiguation = db?.resolver?.disambiguation?.[modelCode];

  if (disambiguation?.position_4?.[bodyCode]) {
    result.warnings.push(`Model code ${modelCode} resolved by body code ${bodyCode}.`);
    downgradeConfidence(result, "medium");
    return disambiguation.position_4[bodyCode];
  }

  result.special_flags.ambiguous_model = true;
  result.possible_matches = [...candidates];
  result.warnings.push(`Ambiguous model code ${modelCode}; unable to resolve uniquely.`);
  downgradeConfidence(result, "low");

  return null;
}

function resolveManufacturer(wmi) {
  const map = {
    TMB: "Skoda Auto",
    XWW: "Skoda Auto",
    XW8: "Skoda Auto",
  };

  return map[wmi] ?? "Unknown";
}

function resolveCountryHint(wmi) {
  const map = {
    TMB: "Czech Republic",
    XWW: "Kazakhstan",
    XW8: "Russia",
  };

  return map[wmi] ?? null;
}

function downgradeConfidence(result, target) {
  const rank = { high: 3, medium: 2, low: 1 };

  if (rank[target] < rank[result.confidence]) {
    result.confidence = target;
  }
}

function normalizeFuelLabel(fuelType) {
  const map = {
    petrol: "Petrol",
    diesel: "Diesel",
    cng: "CNG",
    phev: "PHEV",
    hybrid: "Hybrid",
    petrol_hybrid: "Hybrid",
    ev: "EV",
  };

  return map[fuelType] ?? "N/A";
}

function inferGearbox(result) {
  const drivetrain = result.body?.drivetrain || "";
  const fuelType = result.engine?.fuel_type || "";
  const powerList = result.engine?.power_kw || [];
  const maxPower = powerList.length ? Math.max(...powerList) : null;

  if (fuelType === "ev") {
    return "EV";
  }

  if (fuelType === "phev" || fuelType === "hybrid" || fuelType === "petrol_hybrid") {
    return "DSG";
  }

  if (maxPower !== null && maxPower >= 140) {
    return "DSG";
  }

  if (drivetrain === "AWD") {
    return "DSG";
  }

  return "Manual";
}

function toEnrichmentModelKey(modelName) {
  const map = {
    Fabia: "FABIA",
    Scala: "SCALA",
    Kamiq: "KAMIQ",
    Karoq: "KAROQ",
    Kodiaq: "KODIAQ",
    Octavia: "OCTAVIA",
    Superb: "SUPERB",
    Enyaq: "ENYAQ",
  };

  return map[modelName] || null;
}

function isYearCompatible(modelYear, mounting) {
  if (!mounting || !mounting.start) return true;

  const startYear = parseInt(String(mounting.start).slice(0, 4), 10);
  const endYear = mounting.end ? parseInt(String(mounting.end).slice(0, 4), 10) : null;

  if (Number.isNaN(startYear)) return true;
  if (modelYear < startYear) return false;
  if (endYear !== null && !Number.isNaN(endYear) && modelYear > endYear) return false;

  return true;
}

function mapInferredGearboxToTechCandidates(inferredGearbox) {
  if (inferredGearbox === "Manual") {
    return ["5S", "6S"];
  }

  if (inferredGearbox === "DSG") {
    return ["6A", "7A", "7C", "8A"];
  }

  if (inferredGearbox === "EV") {
    return ["1E"];
  }

  return [];
}

function unique(items) {
  return [...new Set((items || []).filter((item) => item !== null && item !== undefined))];
}

export const decodeSkodaVin = decodeVin;
