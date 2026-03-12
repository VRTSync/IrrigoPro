import { db } from "./db";
import { customers, parts, estimates, estimateZones, estimateItems, propertyZones, zones, users, workOrders, workOrderItems, billingSheets, billingSheetItems } from "@shared/schema";

export async function seedDatabase() {
  console.log("Starting database seeding...");

  try {
    // Seed users first
    const sampleUsers = [
      {
        id: '1',
        username: 'admin',
        password: 'admin123',
        name: 'Admin User',
        email: 'admin@company.com',
        role: 'admin' as const,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: '2',
        username: 'manager',
        password: 'manager123',
        name: 'Manager User',
        email: 'manager@company.com',
        role: 'irrigation_manager' as const,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: '3',
        username: 'tech',
        password: 'tech123',
        name: 'John Tech',
        email: 'tech@company.com',
        role: 'field_tech' as const,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    const insertedUsers = await db.insert(users).values(sampleUsers).returning();
    console.log(`Inserted ${insertedUsers.length} users`);

    // Seed customers with contract-based billing rates
    const sampleCustomers = [
      { 
        name: "Johnson Family", 
        email: "johnson@example.com", 
        phone: "(555) 123-4567", 
        address: "123 Oak Street, Springfield, IL 62701",
        contractType: "residential",
        laborRate: "42.00",
        markupPercent: "18.00",
        taxPercent: "8.25",
        discountPercent: "0.00",
        paymentTerms: "net_30",
        notes: "Preferred residential customer with seasonal maintenance contract"
      },
      { 
        name: "Office Complex Management", 
        email: "manager@officecomplex.com", 
        phone: "(555) 234-5678", 
        address: "456 Business Ave, Springfield, IL 62702",
        contractType: "commercial",
        laborRate: "55.00",
        markupPercent: "25.00",
        taxPercent: "8.25",
        discountPercent: "5.00",
        paymentTerms: "net_15",
        notes: "Commercial contract with bulk pricing discount"
      },
      { 
        name: "Garden Center LLC", 
        email: "info@gardencenter.com", 
        phone: "(555) 345-6789", 
        address: "789 Garden Way, Springfield, IL 62703",
        contractType: "premium",
        laborRate: "50.00",
        markupPercent: "22.00",
        taxPercent: "8.25",
        discountPercent: "10.00",
        paymentTerms: "net_30",
        notes: "Premium service contract with priority scheduling"
      },
      { 
        name: "Smith Residence", 
        email: "smith@example.com", 
        phone: "(555) 456-7890", 
        address: "321 Maple Drive, Springfield, IL 62704",
        contractType: "standard",
        laborRate: "45.00",
        markupPercent: "20.00",
        taxPercent: "8.25",
        discountPercent: "0.00",
        paymentTerms: "net_30",
        notes: "Standard residential customer"
      },
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

    // Seed work orders
    const sampleWorkOrders = [
      {
        workOrderNumber: "WO-2024-001",
        customerId: insertedCustomers[0].id,
        customerName: insertedCustomers[0].name,
        customerEmail: insertedCustomers[0].email,
        customerPhone: insertedCustomers[0].phone,
        projectName: "Sprinkler System Installation",
        projectAddress: insertedCustomers[0].address,
        status: "pending",
        priority: "medium",
        workType: "estimate_based",
        estimateId: insertedEstimates[0].id,
        assignedTechnicianId: null,
        assignedTechnicianName: null,
        scheduledDate: new Date("2024-07-20"),
        notes: "Install new sprinkler system based on approved estimate",
        partsSubtotal: "450.00",
        laborSubtotal: "562.50",
        totalAmount: "1315.16",
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        workOrderNumber: "WO-2024-002",
        customerId: insertedCustomers[1].id,
        customerName: insertedCustomers[1].name,
        customerEmail: insertedCustomers[1].email,
        customerPhone: insertedCustomers[1].phone,
        projectName: "Commercial Irrigation Repair",
        projectAddress: insertedCustomers[1].address,
        status: "in_progress",
        priority: "high",
        workType: "direct_billing",
        estimateId: null,
        assignedTechnicianId: 3,
        assignedTechnicianName: "Field Technician",
        scheduledDate: new Date("2024-07-18"),
        notes: "Emergency repair of main irrigation line",
        partsSubtotal: "125.00",
        laborSubtotal: "200.00",
        totalAmount: "325.00",
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        workOrderNumber: "WO-2024-003",
        customerId: insertedCustomers[2].id,
        customerName: insertedCustomers[2].name,
        customerEmail: insertedCustomers[2].email,
        customerPhone: insertedCustomers[2].phone,
        projectName: "Seasonal Maintenance",
        projectAddress: insertedCustomers[2].address,
        status: "completed",
        priority: "low",
        workType: "direct_billing",
        estimateId: null,
        assignedTechnicianId: 3,
        assignedTechnicianName: "Field Technician",
        scheduledDate: new Date("2024-07-15"),
        notes: "Complete seasonal maintenance and system check",
        partsSubtotal: "75.00",
        laborSubtotal: "150.00",
        totalAmount: "225.00",
        completedAt: new Date("2024-07-16"),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    const insertedWorkOrders = await db.insert(workOrders).values(sampleWorkOrders).returning();
    console.log(`Inserted ${insertedWorkOrders.length} work orders`);

    console.log("Database seeding completed successfully!");
  } catch (error) {
    console.error("Error seeding database:", error);
    throw error;
  }
}

export async function seedBillingMonth() {
  console.log("Seeding billing month data...");

  try {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const existingCustomers = await db.select().from(customers).limit(1);
    if (existingCustomers.length === 0) {
      console.log("No customers found. Run seedDatabase() first.");
      return;
    }
    const customer = existingCustomers[0];

    const existingParts = await db.select().from(parts).limit(3);
    if (existingParts.length < 2) {
      console.log("Not enough parts found. Run seedDatabase() first.");
      return;
    }

    const woDate1 = new Date(currentYear, currentMonth, 5);
    const woDate2 = new Date(currentYear, currentMonth, 12);

    const insertedWOs = await db.insert(workOrders).values([
      {
        workOrderNumber: `WO-SEED-${currentYear}${String(currentMonth+1).padStart(2,'0')}-A`,
        customerId: customer.id,
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        projectName: "Monthly Sprinkler Inspection",
        projectAddress: customer.address,
        workType: "direct_billing",
        status: "completed",
        priority: "medium",
        scheduledDate: woDate1,
        completedAt: woDate1,
        assignedTechnicianId: null,
        assignedTechnicianName: "John Tech",
        completedByUserName: "John Tech",
        totalHours: "3.50",
        totalPartsCost: "74.50",
        laborRate: customer.laborRate || "45.00",
        laborSubtotal: (3.5 * parseFloat(customer.laborRate || "45.00")).toFixed(2),
        partsSubtotal: "74.50",
        totalAmount: (3.5 * parseFloat(customer.laborRate || "45.00") + 74.50).toFixed(2),
        totalItems: 3,
        workSummary: "Inspected and repaired sprinkler heads in front yard. Replaced 2 damaged nozzles and adjusted spray patterns.",
        createdAt: woDate1,
        updatedAt: woDate1,
      },
      {
        workOrderNumber: `WO-SEED-${currentYear}${String(currentMonth+1).padStart(2,'0')}-B`,
        customerId: customer.id,
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        projectName: "Valve Replacement - Back Yard",
        projectAddress: customer.address,
        workType: "direct_billing",
        status: "completed",
        priority: "high",
        scheduledDate: woDate2,
        completedAt: woDate2,
        assignedTechnicianId: null,
        assignedTechnicianName: "John Tech",
        completedByUserName: "John Tech",
        totalHours: "2.00",
        totalPartsCost: "65.00",
        laborRate: customer.laborRate || "45.00",
        laborSubtotal: (2.0 * parseFloat(customer.laborRate || "45.00")).toFixed(2),
        partsSubtotal: "65.00",
        totalAmount: (2.0 * parseFloat(customer.laborRate || "45.00") + 65.00).toFixed(2),
        totalItems: 2,
        workSummary: "Replaced faulty irrigation valve in back yard zone. Tested system pressure and verified operation.",
        createdAt: woDate2,
        updatedAt: woDate2,
      },
    ]).returning();

    console.log(`Inserted ${insertedWOs.length} completed work orders for current month`);

    await db.insert(workOrderItems).values([
      {
        workOrderId: insertedWOs[0].id,
        partId: existingParts[0].id,
        partName: existingParts[0].name,
        partPrice: existingParts[0].price,
        quantity: 2,
        laborHours: "1.00",
        totalPrice: (2 * parseFloat(existingParts[0].price)).toFixed(2),
      },
      {
        workOrderId: insertedWOs[0].id,
        partId: existingParts[1].id,
        partName: existingParts[1].name,
        partPrice: existingParts[1].price,
        quantity: 1,
        laborHours: "0.75",
        totalPrice: existingParts[1].price,
      },
      {
        workOrderId: insertedWOs[1].id,
        partId: existingParts[2] ? existingParts[2].id : existingParts[0].id,
        partName: existingParts[2] ? existingParts[2].name : existingParts[0].name,
        partPrice: existingParts[2] ? existingParts[2].price : existingParts[0].price,
        quantity: 2,
        laborHours: "0.50",
        totalPrice: (2 * parseFloat(existingParts[2] ? existingParts[2].price : existingParts[0].price)).toFixed(2),
      },
    ]);

    console.log("Inserted work order items");

    const bsDate = new Date(currentYear, currentMonth, 18);
    const bsLaborRate = customer.laborRate || "45.00";
    const bsTotalHours = "4.00";
    const bsLaborSubtotal = (4.0 * parseFloat(bsLaborRate)).toFixed(2);
    const bsPartsSubtotal = "99.75";
    const bsMarkupAmount = (parseFloat(bsPartsSubtotal) * parseFloat(customer.markupPercent || "20.00") / 100).toFixed(2);
    const bsTaxAmount = ((parseFloat(bsPartsSubtotal) + parseFloat(bsLaborSubtotal) + parseFloat(bsMarkupAmount)) * parseFloat(customer.taxPercent || "8.25") / 100).toFixed(2);
    const bsTotalAmount = (parseFloat(bsPartsSubtotal) + parseFloat(bsLaborSubtotal) + parseFloat(bsMarkupAmount) + parseFloat(bsTaxAmount)).toFixed(2);

    const insertedBS = await db.insert(billingSheets).values([
      {
        billingNumber: `BS-SEED-${currentYear}${String(currentMonth+1).padStart(2,'0')}-A`,
        customerId: customer.id,
        customerName: customer.name,
        propertyAddress: customer.address || "123 Oak Street",
        workDate: bsDate,
        technicianName: "John Tech",
        workDescription: "Emergency drip line repair and winterization prep for garden beds",
        status: "approved",
        totalHours: bsTotalHours,
        laborRate: bsLaborRate,
        laborSubtotal: bsLaborSubtotal,
        partsSubtotal: bsPartsSubtotal,
        markupAmount: bsMarkupAmount,
        taxAmount: bsTaxAmount,
        totalAmount: bsTotalAmount,
        notes: "Customer reported leaking drip lines. Replaced damaged sections and added frost protection.",
        createdAt: bsDate,
        updatedAt: bsDate,
      },
    ]).returning();

    console.log(`Inserted ${insertedBS.length} approved billing sheet for current month`);

    await db.insert(billingSheetItems).values([
      {
        billingSheetId: insertedBS[0].id,
        partId: existingParts[0].id,
        partName: existingParts[0].name,
        partDescription: existingParts[0].description,
        quantity: "3",
        unitPrice: existingParts[0].price,
        totalPrice: (3 * parseFloat(existingParts[0].price)).toFixed(2),
        laborHours: "1.50",
      },
      {
        billingSheetId: insertedBS[0].id,
        partId: existingParts[1].id,
        partName: existingParts[1].name,
        partDescription: existingParts[1].description,
        quantity: "1",
        unitPrice: existingParts[1].price,
        totalPrice: existingParts[1].price,
        laborHours: "0.75",
      },
    ]);

    console.log("Inserted billing sheet items");
    console.log(`\nBilling month seed complete for ${customer.name} in ${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`);
    console.log("Created: 2 completed work orders + 1 approved billing sheet with realistic parts and labor");
  } catch (error) {
    console.error("Error seeding billing month data:", error);
    throw error;
  }
}

// Run seeding if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabase().catch(console.error);
}