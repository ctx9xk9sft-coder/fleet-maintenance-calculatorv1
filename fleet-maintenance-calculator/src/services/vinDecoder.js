import vinDatabase from "../data/vin_database.json";

export function decodeVin(vin) {

  const cleanVin = vin.trim().toUpperCase();

  if (cleanVin.length !== 17) {
    return {
      valid: false,
      error: "VIN mora imati 17 karaktera"
    };
  }

  const wmi = cleanVin.slice(0,3);
  const bodyCode = cleanVin[3];
  const engineCode = cleanVin[4];
  const airbagCode = cleanVin[5];
  const modelCode = cleanVin.slice(6,8);
  const yearCode = cleanVin[9];
  const plantCode = cleanVin[10];
  const serial = cleanVin.slice(11,17);

  const resolver = vinDatabase.resolver.by_model_code;

  const possibleModels = resolver[modelCode];

  if (!possibleModels) {
    return {
      valid:false,
      error:"Nepoznat model kod"
    };
  }

  const modelId = possibleModels[0];

  const modelRules = vinDatabase.models[modelId];

  const body = modelRules.body_map[bodyCode];
  const engine = modelRules.engine_map[engineCode];
  const airbags = modelRules.airbag_map[airbagCode];
  const year = modelRules.year_map[yearCode];
  const plant = modelRules.plant_map[plantCode];

  return {
    valid:true,
    vin:cleanVin,

    manufacturer:"Skoda",

    model:{
      name:modelRules.name,
      generation:modelRules.generation
    },

    body:body,
    engine:engine,
    airbags:airbags,
    year:year,
    plant:plant,

    serial:serial
  };
}
