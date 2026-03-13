import vinDatabase from "../data/vin_database.json";

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

    // UI kompatibilnost
    marka: "Skoda",
    model: null,
    motorKod: null,
    motor: null,
    menjac: null,
    modelYear: null,
    drivetrain: null,
    gearboxCode: "N/A",
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

  // UI kompatibilnost
  result.marka = "Skoda";
  result.model = [result.model_info.name, result.model_info.generation].filter(Boolean).join(" ");
  result.motorKod = result.engine.code || "N/A";
  result.motor = result.engine.description || "N/A";
  result.menjac = inferGearbox(result);
  result.modelYear = result.model_year.year || null;
  result.drivetrain = result.body.drivetrain || "N/A";
  result.fuelType = normalizeFuelLabel(result.engine.fuel_type);
  result.candidates = result.possible_matches || [];
  result.reason = result.valid
    ? null
    : (result.validation_errors.join(", ") || "VIN nije podržan");

  return result;
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

  if (fuelType === "phev" || fuelType === "hybrid") {
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

export const decodeSkodaVin = decodeVin;
