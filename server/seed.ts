import { db } from "./db";
import { customers, parts, estimates, estimateZones, estimateItems, propertyZones, zones } from "@shared/schema";

export async function seedDatabase() {
  console.log("Starting database seeding...");

  try {
    // Seed customers
    const sampleCustomers = [
      { name: "Johnson Family", email: "johnson@example.com", phone: "(555) 123-4567", address: "123 Oak Street, Springfield, IL 62701" },
      { name: "Office Complex Management", email: "manager@officecomplex.com", phone: "(555) 234-5678", address: "456 Business Ave, Springfield, IL 62702" },
      { name: "Garden Center LLC", email: "info@gardencenter.com", phone: "(555) 345-6789", address: "789 Garden Way, Springfield, IL 62703" },
      { name: "Smith Residence", email: "smith@example.com", phone: "(555) 456-7890", address: "321 Maple Drive, Springfield, IL 62704" },
    ];

    const insertedCustomers = await db.insert(customers).values(sampleCustomers).returning();
    console.log(`Inserted ${insertedCustomers.length} customers`);

    // Seed parts
    const sampleParts = [
      { name: "Rain Bird 5004 Sprinkler", description: "Pop-up spray head with adjustable pattern", price: "18.50", laborHours: "0.50", sku: "RB-5004", category: "Sprinklers" },
      { name: "Hunter PGP-ADJ Rotor", description: "Adjustable arc rotary sprinkler", price: "42.75", laborHours: "0.75", sku: "HU-PGP-ADJ", category: "Rotors" },
      { name: "1\" PVC Pipe (10ft)", description: "Schedule 40 PVC pipe for irrigation", price: "12.25", laborHours: "0.25", sku: "PVC-1-10", category: "Pipes" },
      { name: "Rain Bird ESP-ME Controller", description: "WiFi-enabled irrigation controller", price: "189.00", laborHours: "2.00", sku: "RB-ESP-ME", category: "Controllers" },
      { name: "Hunter Pro-Spray Body", description: "Professional grade spray head body", price: "8.75", laborHours: "0.30", sku: "HU-PS-BODY", category: "Sprinklers" },
      { name: "Toro Super 800 Nozzle", description: "High-efficiency spray nozzle", price: "3.25", laborHours: "0.10", sku: "TO-S800", category: "Nozzles" },
      { name: "Irritrol 2400 Valve", description: "24V AC irrigation valve", price: "32.50", laborHours: "0.60", sku: "IR-2400", category: "Valves" },
      { name: "1/2\" Poly Tubing (100ft)", description: "Flexible polyethylene tubing", price: "24.99", laborHours: "0.75", sku: "POLY-05-100", category: "Tubing" },
    ];

    const insertedParts = await db.insert(parts).values(sampleParts).returning();
    console.log(`Inserted ${insertedParts.length} parts`);

    // Seed property zones
    const samplePropertyZones = [
      { propertyName: "Greenfield Corporate Campus", propertyAddress: "100 Corporate Blvd, Austin, TX 78701", contactName: "Mike Johnson", contactEmail: "mike@greenfield.com", contactPhone: "(555) 111-2222" },
      { propertyName: "Sunset Residential Complex", propertyAddress: "200 Sunset Drive, Austin, TX 78702", contactName: "Sarah Wilson", contactEmail: "sarah@sunset.com", contactPhone: "(555) 333-4444" },
      { propertyName: "Downtown Office Plaza", propertyAddress: "300 Main Street, Austin, TX 78703", contactName: "Robert Chen", contactEmail: "robert@downtown.com", contactPhone: "(555) 555-6666" },
    ];

    const insertedPropertyZones = await db.insert(propertyZones).values(samplePropertyZones).returning();
    console.log(`Inserted ${insertedPropertyZones.length} property zones`);

    // Seed zones for each property
    const sampleZones = [
      // Greenfield Corporate Campus zones
      { propertyId: insertedPropertyZones[0].id, name: "Front Entrance", description: "Main entrance landscaping area", clockNumber: "C001" },
      { propertyId: insertedPropertyZones[0].id, name: "East Parking", description: "Eastern parking lot perimeter", clockNumber: "C002" },
      { propertyId: insertedPropertyZones[0].id, name: "West Courtyard", description: "Western courtyard garden area", clockNumber: "C003" },
      
      // Sunset Residential Complex zones
      { propertyId: insertedPropertyZones[1].id, name: "Pool Area", description: "Swimming pool and deck landscaping", clockNumber: "R001" },
      { propertyId: insertedPropertyZones[1].id, name: "Building A Perimeter", description: "Around Building A foundation", clockNumber: "R002" },
      { propertyId: insertedPropertyZones[1].id, name: "Central Lawn", description: "Main common area lawn", clockNumber: "R003" },
      
      // Downtown Office Plaza zones
      { propertyId: insertedPropertyZones[2].id, name: "Lobby Entrance", description: "Main lobby entrance planters", clockNumber: "D001" },
      { propertyId: insertedPropertyZones[2].id, name: "Rooftop Garden", description: "Rooftop garden and terrace", clockNumber: "D002" },
    ];

    const insertedZones = await db.insert(zones).values(sampleZones).returning();
    console.log(`Inserted ${insertedZones.length} zones`);

    // Seed estimates
    const sampleEstimates = [
      {
        estimateNumber: "EST-2024-001",
        customerId: insertedCustomers[0].id,
        customerName: insertedCustomers[0].name,
        customerEmail: insertedCustomers[0].email,
        customerPhone: insertedCustomers[0].phone,
        projectName: "Residential Sprinkler System",
        projectAddress: insertedCustomers[0].address,
        status: "pending",
        partsSubtotal: "450.00",
        laborSubtotal: "562.50",
        markupAmount: "202.50",
        taxAmount: "100.16",
        totalAmount: "1315.16",
        laborRate: "75.00",
        markupPercent: "20.00",
        taxPercent: "8.25",
      },
      {
        estimateNumber: "EST-2024-002",
        customerId: insertedCustomers[1].id,
        customerName: insertedCustomers[1].name,
        customerEmail: insertedCustomers[1].email,
        customerPhone: insertedCustomers[1].phone,
        projectName: "Commercial Irrigation",
        projectAddress: insertedCustomers[1].address,
        status: "approved",
        partsSubtotal: "1250.00",
        laborSubtotal: "1875.00",
        markupAmount: "625.00",
        taxAmount: "309.38",
        totalAmount: "4059.38",
        laborRate: "75.00",
        markupPercent: "20.00",
        taxPercent: "8.25",
      },
    ];

    const insertedEstimates = await db.insert(estimates).values(sampleEstimates).returning();
    console.log(`Inserted ${insertedEstimates.length} estimates`);

    // Seed estimate zones
    const sampleEstimateZones = [
      { estimateId: insertedEstimates[0].id, zoneName: "Front Yard", workDescription: "Install sprinkler system for front lawn and flower beds", clockInTime: "8:00 AM", sortOrder: 1 },
      { estimateId: insertedEstimates[0].id, zoneName: "Back Yard", workDescription: "Install rotor system for large back lawn area", clockInTime: "10:00 AM", sortOrder: 2 },
      { estimateId: insertedEstimates[1].id, zoneName: "Parking Area", workDescription: "Install commercial sprinkler system for landscaping", clockInTime: "7:00 AM", sortOrder: 1 },
    ];

    const insertedEstimateZones = await db.insert(estimateZones).values(sampleEstimateZones).returning();
    console.log(`Inserted ${insertedEstimateZones.length} estimate zones`);

    // Seed estimate items
    const sampleEstimateItems = [
      { estimateId: insertedEstimates[0].id, zoneId: insertedEstimateZones[0].id, partId: insertedParts[0].id, partName: insertedParts[0].name, partPrice: insertedParts[0].price, quantity: 8, laborHours: "4.00", totalPrice: "148.00" },
      { estimateId: insertedEstimates[0].id, zoneId: insertedEstimateZones[1].id, partId: insertedParts[1].id, partName: insertedParts[1].name, partPrice: insertedParts[1].price, quantity: 6, laborHours: "4.50", totalPrice: "256.50" },
      { estimateId: insertedEstimates[1].id, zoneId: insertedEstimateZones[2].id, partId: insertedParts[3].id, partName: insertedParts[3].name, partPrice: insertedParts[3].price, quantity: 2, laborHours: "4.00", totalPrice: "378.00" },
    ];

    const insertedEstimateItems = await db.insert(estimateItems).values(sampleEstimateItems).returning();
    console.log(`Inserted ${insertedEstimateItems.length} estimate items`);

    console.log("Database seeding completed successfully!");
  } catch (error) {
    console.error("Error seeding database:", error);
    throw error;
  }
}

// Run seeding if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabase().catch(console.error);
}