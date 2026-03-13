import vinDatabase from "../data/vin_database.json";
import engineCodesDb from "../data/engine_codes.json";
import gearboxCodesDb from "../data/gearbox_codes.json";
import vinTrainingDataset from "../data/vin_training_dataset.json";
import engineCodesMaster from "../data/engine_codes_master.json";
import gearboxCodesMaster from "../data/gearbox_codes_master.json";

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
      unit_code: null,
      family: null,
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
      exactVinMatch: null,
      possibleEngineCodes: [],
      engineCandidates: [],
      possibleGearboxCodes: [],
      gearboxTechCandidates: [],
      engineSource: "not_enriched",
      gearboxSource: "not_enriched",
      selectedEngine: null,
      selectedGearbox: null,
      masterEngine: null,
      masterGearbox: null,
      source: "legacy_vin_decoder",
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

  enrichWithExactVinDataset(result);

  // Ako postoji exact VIN pogodak, ne dozvoli da ga fallback sloj razvodni
  if (!isExactDatasetMatch(result)) {
    enrichWithEngineCodes(result);
    enrichWithGearboxCodes(result);
  }

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

  if (isExactDatasetMatch(result)) {
    result.gearboxCode =
      result.enrichment?.exactVinMatch?.transmissionCode ||
      result.gearboxCode ||
      "N/A";
    result.gearboxCodeSource = "exact_vin_training_dataset";
    result.menjacSource = "vin_training_dataset_exact";
    result.confidence = "exact";
  } else if (result.enrichment.possibleGearboxCodes.length > 0) {
    result.gearboxCode = result.enrichment.possibleGearboxCodes.join(", ");
    result.gearboxCodeSource = "enriched_from_model_year_profile";
  }

  applyOilDataToUi(result);

  result.reason = result.valid
    ? null
    : (result.validation_errors.join(", ") || "VIN nije podržan");

  return result;
}

function enrichWithExactVinDataset(result) {
  const exact = findExactVinMatch(result.vin);
  if (!exact) return;

  result.enrichment.exactVinMatch = exact;
  result.enrichment.source = "vin_training_dataset_exact";
  result.confidence = "exact";

  if (exact.model) {
    result.model_info.name = exact.model;
  }

  if (exact.modelYear != null) {
    result.model_year.year = exact.modelYear;
  }

  if (exact.engineCode) {
    result.engine.code = exact.engineCode;
    result.motorKod = exact.engineCode;
    result.enrichment.possibleEngineCodes = [exact.engineCode];
    result.enrichment.engineSource = "vin_training_dataset_exact";
  }

  if (exact.transmissionCode) {
    result.gearboxCode = exact.transmissionCode;
    result.enrichment.possibleGearboxCodes = [exact.transmissionCode];
    result.enrichment.gearboxSource = "vin_training_dataset_exact";
    result.gearboxCodeSource = "exact_vin_training_dataset";
    result.menjacSource = "vin_training_dataset_exact";
  }

  if (exact.drivetrain) {
    result.body.drivetrain = exact.drivetrain;
  }

  if (exact.serviceRegime) {
    result.serviceRegime = exact.serviceRegime;
  }

  if (exact.serviceIndicator) {
    result.serviceIndicator = exact.serviceIndicator;
  }

  if (exact.engineUnit) {
    result.engine.unit_code = exact.engineUnit;
  }

  const masterEngine = exact.engineCode ? engineCodesMaster?.[exact.engineCode] : null;
  if (masterEngine) {
    result.enrichment.masterEngine = masterEngine;
    result.enrichment.selectedEngine = {
      code: exact.engineCode,
      ...masterEngine,
      kw: masterEngine.powerKw ?? null,
      fuel_type: masterEngine.fuel ?? null,
      displacement_l: masterEngine.displacementL ?? null,
      oil_capacity_l: masterEngine.oilCapacityL ?? null,
      oil_spec: masterEngine.oilSpec ?? null,
      oil_viscosity: masterEngine.oilViscosity ?? null,
      notes: masterEngine.description ?? null,
    };

    result.engine.code = exact.engineCode;
    result.engine.family = masterEngine.family ?? null;
    result.engine.unit_code = masterEngine.engineUnit ?? result.engine.unit_code;
    result.engine.description = masterEngine.description ?? result.engine.description;
    result.engine.fuel_type = masterEngine.fuel ?? result.engine.fuel_type;
    result.engine.displacement_l =
      masterEngine.displacementL ?? result.engine.displacement_l;

    if (masterEngine.powerKw != null) {
      result.engine.power_kw = [masterEngine.powerKw];
      result.engine.power_kw_display = String(masterEngine.powerKw);
    }

    if (masterEngine.oilCapacityL != null) {
      result.oilCapacity = `${masterEngine.oilCapacityL} L`;
    }
    if (masterEngine.oilSpec) {
      result.oilSpec = masterEngine.oilSpec;
    }
    if (masterEngine.oilViscosity) {
      result.oilSae = masterEngine.oilViscosity;
    }
  }

  const masterGearbox = exact.transmissionCode
    ? gearboxCodesMaster?.[exact.transmissionCode]
    : null;

  if (masterGearbox) {
    result.enrichment.masterGearbox = masterGearbox;
    result.enrichment.selectedGearbox = {
      code: exact.transmissionCode,
      ...masterGearbox,
    };

    result.gearboxCode = exact.transmissionCode;
    result.gearboxCodeSource = "exact_vin_training_dataset";
    result.menjacSource = "vin_training_dataset_exact";

    if (masterGearbox.drivetrain) {
      result.body.drivetrain = masterGearbox.drivetrain;
    }
  }

  result.vin_summary.model = result.model_info.name;
  result.vin_summary.drivetrain = result.body.drivetrain;
  result.vin_summary.fuel_type = normalizeFuelLabel(result.engine.fuel_type);
  result.vin_summary.power_kw = result.engine.power_kw_display || null;
  result.vin_summary.model_year = result.model_year.year;
}

function isExactDatasetMatch(result) {
  return result?.enrichment?.source === "vin_training_dataset_exact";
}

function findExactVinMatch(vin) {
  if (!Array.isArray(vinTrainingDataset)) return null;
  return vinTrainingDataset.find((item) => item?.vin === vin) || null;
}

function enrichWithEngineCodes(result) {
  if (isExactDatasetMatch(result) && result.enrichment?.exactVinMatch?.engineCode) {
    return;
  }

  const modelKey = toEnrichmentModelKey(result.model_info.name);
  if (!modelKey) {
    return;
  }

  const exactEngineCodes = result.enrichment?.exactVinMatch?.engineCode
    ? [result.enrichment.exactVinMatch.engineCode]
    : [];

  const engines = engineCodesDb?.engines || {};
  const modelYear = result.model_year?.year || null;
  const displacement = result.engine?.displacement_l ?? null;
  const fuelType = result.engine?.fuel_type ?? null;
  const powers = Array.isArray(result.engine?.power_kw) ? result.engine.power_kw : [];

  const candidates = Object.values(engines)
    .filter((item) =>
      isEngineCandidateCompatible(
        item,
        modelKey,
        modelYear,
        fuelType,
        displacement,
        powers
      )
    )
    .map((item) => {
      const matchedApplications = filterMatchingApplications(item, modelKey, modelYear);
      return {
        ...item,
        matchedApplications,
        _score: scoreEngineCandidate(item, matchedApplications, exactEngineCodes),
      };
    })
    .sort(compareEngineCandidates);

  result.enrichment.engineCandidates = candidates;

  const combinedCodes = unique([
    ...exactEngineCodes,
    ...candidates.map((item) => item.code),
  ]);

  result.enrichment.possibleEngineCodes = combinedCodes;

  if (combinedCodes.length > 0 && result.enrichment.engineSource === "not_enriched") {
    result.enrichment.engineSource =
      exactEngineCodes.length > 0
        ? "vin_training_dataset_exact"
        : "enriched_from_engine_master";
  }

  if (combinedCodes.length > 1 && exactEngineCodes.length === 0) {
    result.warnings.push("Multiple possible ETKA engine codes matched the VIN profile.");
    downgradeConfidence(result, "medium");
  }

  if (combinedCodes.length === 0) {
    return;
  }

  if (exactEngineCodes.length === 1) {
    const exactCode = exactEngineCodes[0];
    const exactCandidate =
      candidates.find((item) => item.code === exactCode) || result.enrichment.selectedEngine;

    if (exactCandidate) {
      if (!result.enrichment.selectedEngine) {
        result.enrichment.selectedEngine = exactCandidate;
      }

      if (!result.engine.description && exactCandidate.notes) {
        result.engine.description = exactCandidate.notes;
      }

      if (!result.engine.fuel_type && exactCandidate.fuel_type) {
        result.engine.fuel_type = exactCandidate.fuel_type;
      }

      if (result.engine.displacement_l == null && exactCandidate.displacement_l != null) {
        result.engine.displacement_l = exactCandidate.displacement_l;
      }

      if ((!result.engine.power_kw || result.engine.power_kw.length === 0) && exactCandidate.kw != null) {
        result.engine.power_kw = [exactCandidate.kw];
        result.engine.power_kw_display = String(exactCandidate.kw);
      }

      if (exactCandidate.oil_capacity_l != null && result.oilCapacity === "N/A") {
        result.oilCapacity = `${exactCandidate.oil_capacity_l} L`;
      }
      if (exactCandidate.oil_spec && result.oilSpec === "N/A") {
        result.oilSpec = exactCandidate.oil_spec;
      }
      if (exactCandidate.oil_viscosity && result.oilSae === "N/A") {
        result.oilSae = exactCandidate.oil_viscosity;
      }
    }

    return;
  }

  const bestCandidate = candidates[0] || null;

  if (bestCandidate && shouldAutoSelectEngineCandidate(bestCandidate, candidates)) {
    result.enrichment.selectedEngine = bestCandidate;
    result.enrichment.possibleEngineCodes = [bestCandidate.code];

    if (!result.engine.description && bestCandidate.notes) {
      result.engine.description = bestCandidate.notes;
    }

    if (!result.engine.fuel_type && bestCandidate.fuel_type) {
      result.engine.fuel_type = bestCandidate.fuel_type;
    }

    if (result.engine.displacement_l == null && bestCandidate.displacement_l != null) {
      result.engine.displacement_l = bestCandidate.displacement_l;
    }

    if ((!result.engine.power_kw || result.engine.power_kw.length === 0) && bestCandidate.kw != null) {
      result.engine.power_kw = [bestCandidate.kw];
      result.engine.power_kw_display = String(bestCandidate.kw);
    }

    if (bestCandidate.oil_capacity_l != null && result.oilCapacity === "N/A") {
      result.oilCapacity = `${bestCandidate.oil_capacity_l} L`;
    }
    if (bestCandidate.oil_spec && result.oilSpec === "N/A") {
      result.oilSpec = bestCandidate.oil_spec;
    }
    if (bestCandidate.oil_viscosity && result.oilSae === "N/A") {
      result.oilSae = bestCandidate.oil_viscosity;
    }

    return;
  }

  const commonOil = getCommonOilData(candidates);
  if (commonOil.capacity_l !== null && result.oilCapacity === "N/A") {
    result.oilCapacity = `${commonOil.capacity_l} L`;
  }
  if (commonOil.spec && result.oilSpec === "N/A") {
    result.oilSpec = commonOil.spec;
  }
  if (commonOil.viscosity && result.oilSae === "N/A") {
    result.oilSae = commonOil.viscosity;
  }
}

function enrichWithGearboxCodes(result) {
  if (isExactDatasetMatch(result) && result.enrichment?.exactVinMatch?.transmissionCode) {
    return;
  }

  const exactTransmissionCode = result.enrichment?.exactVinMatch?.transmissionCode || null;
  if (exactTransmissionCode) {
    result.enrichment.possibleGearboxCodes = unique([
      exactTransmissionCode,
      ...result.enrichment.possibleGearboxCodes,
    ]);
    result.enrichment.gearboxSource = "vin_training_dataset_exact";
  }

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

  const combinedCodes = unique([
    ...result.enrichment.possibleGearboxCodes,
    ...filtered.map((item) => item.code),
  ]);

  result.enrichment.possibleGearboxCodes = combinedCodes;
  result.enrichment.gearboxTechCandidates = unique(filtered.map((item) => item.tech_info));

  if (combinedCodes.length > 0 && result.enrichment.gearboxSource === "not_enriched") {
    result.enrichment.gearboxSource =
      exactTransmissionCode
        ? "vin_training_dataset_exact"
        : "enriched_from_model_year_inferred_gearbox";
  }

  if (combinedCodes.length > 1 && !exactTransmissionCode) {
    result.warnings.push("Multiple possible gearbox codes matched the VIN profile.");
    downgradeConfidence(result, "medium");
  }
}

function isEngineCandidateCompatible(item, modelKey, modelYear, fuelType, displacement, powers) {
  if (!item) return false;

  const hasApplications =
    Array.isArray(item.applications) && item.applications.length > 0;

  const matchingApplications = filterMatchingApplications(item, modelKey, modelYear);

  if (hasApplications) {
    if (matchingApplications.length === 0) return false;
  } else {
    const matchesModel =
      Array.isArray(item.models) && item.models.includes(modelKey);

    if (!matchesModel) return false;
  }

  if (fuelType && item.fuel_type && !isFuelCompatible(item.fuel_type, fuelType)) {
    return false;
  }

  if (
    displacement !== null &&
    item.displacement_l != null &&
    Number(item.displacement_l) !== Number(displacement)
  ) {
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

function scoreEngineCandidate(item, matchedApplications, exactEngineCodes = []) {
  let score = 0;

  if (Array.isArray(matchedApplications) && matchedApplications.length > 0) {
    score += 100;
    score += matchedApplications.length === 1 ? 20 : 10;
  }

  if (exactEngineCodes.includes(item.code)) {
    score += 1000;
  }

  if (item.oil_capacity_l != null) score += 5;
  if (item.oil_spec) score += 5;
  if (item.oil_viscosity) score += 5;
  if (item.timing_drive) score += 2;
  if (item.kw != null) score += 1;

  return score;
}

function compareEngineCandidates(a, b) {
  const scoreDiff = (b?._score || 0) - (a?._score || 0);
  if (scoreDiff !== 0) return scoreDiff;

  const aCode = a?.code || "";
  const bCode = b?.code || "";
  return aCode.localeCompare(bCode);
}

function shouldAutoSelectEngineCandidate(bestCandidate, candidates) {
  if (!bestCandidate) return false;
  if (!Array.isArray(candidates) || candidates.length === 0) return false;
  if (candidates.length === 1) return true;

  const second = candidates[1];
  if (!second) return true;

  const bestHasApplications =
    Array.isArray(bestCandidate.matchedApplications) &&
    bestCandidate.matchedApplications.length > 0;

  const secondHasApplications =
    Array.isArray(second.matchedApplications) &&
    second.matchedApplications.length > 0;

  if (bestHasApplications && !secondHasApplications) return true;

  const bestScore = bestCandidate._score || 0;
  const secondScore = second._score || 0;

  return bestScore - secondScore >= 20;
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
    if (selected.oil_capacity_l != null && result.oilCapacity === "N/A") {
      result.oilCapacity = `${selected.oil_capacity_l} L`;
    }
    if (selected.oil_spec && result.oilSpec === "N/A") {
      result.oilSpec = selected.oil_spec;
    }
    if (selected.oil_viscosity && result.oilSae === "N/A") {
      result.oilSae = selected.oil_viscosity;
    }
    return;
  }

  const commonOil = getCommonOilData(result.enrichment?.engineCandidates || []);

  if (commonOil.capacity_l != null && result.oilCapacity === "N/A") {
    result.oilCapacity = `${commonOil.capacity_l} L`;
  }
  if (commonOil.spec && result.oilSpec === "N/A") {
    result.oilSpec = commonOil.spec;
  }
  if (commonOil.viscosity && result.oilSae === "N/A") {
    result.oilSae = commonOil.viscosity;
  }
}

function buildUiEngineLabel(result) {
  const selected = result.enrichment?.selectedEngine;

  if (selected) {
    const parts = [];
    const description = selected.notes || "";

    if (selected.displacement_l != null) {
      parts.push(`${selected.displacement_l.toFixed(1)}`);
    }

    if (description) {
      parts.push(cleanEngineDescription(description, selected.displacement_l, selected.kw));
    } else if (selected.fuel_type) {
      parts.push(normalizeFuelLabel(selected.fuel_type));
    }

    if (selected.kw != null) {
      parts.push(`${selected.kw} kW`);
    }

    return parts.join(" ").trim() || result.engine.description || "N/A";
  }

  return cleanEngineDescription(result.engine.description || "") || "N/A";
}

function cleanEngineDescription(description, displacement, kw) {
  let text = String(description || "").trim();
  if (!text) return "";

  text = text.replace(/\s+/g, " ");

  if (displacement != null) {
    const d = Number(displacement).toFixed(1).replace(".", "\\.");
    text = text.replace(new RegExp(`\\b${d}\\s*l\\b`, "gi"), "").trim();
    text = text.replace(new RegExp(`\\b${d}\\b`, "gi"), "").trim();
  }

  if (kw != null) {
    text = text.replace(new RegExp(`\\b${kw}\\s*kW\\b`, "gi"), "").trim();
    text = text.replace(new RegExp(`\\b${kw}\\b`, "gi"), "").trim();
  }

  text = text.replace(/\s{2,}/g, " ").trim();
  text = text.replace(/^\/+\s*/, "").trim();
  text = text.replace(/\s*\/+\s*/g, " / ").trim();

  return text;
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
  const rank = { exact: 4, high: 3, medium: 2, low: 1 };

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
  const selectedMasterGearbox = result.enrichment?.masterGearbox;
  if (selectedMasterGearbox?.type === "manual") {
    return "Manual";
  }
  if (selectedMasterGearbox?.type === "DSG") {
    return "DSG";
  }

  const exactTransmissionCode = result.enrichment?.exactVinMatch?.transmissionCode || null;
  if (exactTransmissionCode) {
    const codeUpper = String(exactTransmissionCode).toUpperCase();
    if (codeUpper.startsWith("W") || codeUpper.startsWith("V") || codeUpper.startsWith("U")) {
      return "DSG";
    }
    if (codeUpper.startsWith("Q") || codeUpper.startsWith("T") || codeUpper.startsWith("S")) {
      return "Manual";
    }
  }

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
