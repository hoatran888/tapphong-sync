/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */

define(['N/record','N/search'], (record, search) => {

    function get(context) {

        log.audit({
            title: 'GET Started',
            details: 'Item Fulfillment V2 GET executed'
        });

        return {
            success: true,
            message: 'Item Fulfillment V2 GET working'
        };
    }

function post(context) {
    try {

                // Read Sales Order ID from Postman
        const soId = Number(context.soId);

        // Read Item ID and Quantity
        const itemId = Number(context.itemId);
        const quantity = Number(context.quantity);

        // Read CartonCloud dispatch ID
        // const dispatchId = context.dispatchId;


        log.audit({
            title: 'TRANSFORM TEST START',
            details: 'Transforming SO10 to Item Fulfillment'
        });

        const fulfillment = record.transform({
            fromType: record.Type.SALES_ORDER,
            fromId: 853,
            toType: record.Type.ITEM_FULFILLMENT,
            isDynamic: false
        });

        // TEST: INVENTORY_STATUS_ASSIGNMENT:start
        // ========================================
// TEST: INVENTORY_STATUS_ASSIGNMENT
// ========================================

const expectedItemId4 = Number(context.itemId);
const expectedLocationId4= Number(context.locationId);
const expectedQuantity4 = Number(context.quantity);

// Inventory Status: Good = Internal ID 1
const inventoryStatusId = 1;

// Find the correct Item Fulfillment line
const lineCount4 = fulfillment.getLineCount({
    sublistId: 'item'
});

let targetLine = -1;

for (let i = 0; i < lineCount4; i++) {

    const itemId = Number(fulfillment.getSublistValue({
        sublistId: 'item',
        fieldId: 'item',
        line: i
    }));

    const locationId = Number(fulfillment.getSublistValue({
        sublistId: 'item',
        fieldId: 'location',
        line: i
    }));

    if (itemId === expectedItemId4 &&
        locationId === expectedLocationId4) {

        targetLine = i;
        break;
    }
}

if (targetLine === -1) {
    return JSON.stringify({
        success: false,
        message: 'Matching fulfillment line not found'
    });
}

// Set fulfillment quantity
fulfillment.setSublistValue({
    sublistId: 'item',
    fieldId: 'quantity',
    line: targetLine,
    value: expectedQuantity4
});

// Mark line for fulfillment
fulfillment.setSublistValue({
    sublistId: 'item',
    fieldId: 'itemreceive',
    line: targetLine,
    value: true
});

// Access the Inventory Detail subrecord
const inventoryDetail = fulfillment.getSublistSubrecord({
    sublistId: 'item',
    fieldId: 'inventorydetail',
    line: targetLine
});

// Add an inventory assignment only if none exists
const assignmentCount = inventoryDetail.getLineCount({
    sublistId: 'inventoryassignment'
});

if (assignmentCount === 0) {

    inventoryDetail.insertLine({
        sublistId: 'inventoryassignment',
        line: 0
    });

    inventoryDetail.setSublistValue({
        sublistId: 'inventoryassignment',
        fieldId: 'inventorystatus',
        line: 0,
        value: inventoryStatusId
    });

    inventoryDetail.setSublistValue({
        sublistId: 'inventoryassignment',
        fieldId: 'quantity',
        line: 0,
        value: expectedQuantity4
    });
}

// Read back the assignment
const assignments = [];

const count = inventoryDetail.getLineCount({
    sublistId: 'inventoryassignment'
});

for (let i = 0; i < count; i++) {

    assignments.push({
        statusId: inventoryDetail.getSublistValue({
            sublistId: 'inventoryassignment',
            fieldId: 'inventorystatus',
            line: i
        }),
        quantity: inventoryDetail.getSublistValue({
            sublistId: 'inventoryassignment',
            fieldId: 'quantity',
            line: i
        })
    });
}
// TEST: SHIPPING STATUS AND MEMO:start
// ========================================
// TEST: SHIPPING STATUS AND MEMO
// ========================================

fulfillment.setValue({
    fieldId: 'shipstatus',
    value: 'C'
});

fulfillment.setValue({
    fieldId: 'memo',
    value: 'CartonCloud Dispatch: ' + context.dispatchId
});

const shippingStatus4 = fulfillment.getValue({
    fieldId: 'shipstatus'
});

const memo4 = fulfillment.getValue({
    fieldId: 'memo'
});

// Return without saving
// return JSON.stringify({
//     success: true,
//     test: 'INVENTORY_STATUS_ASSIGNMENT',
//     itemId: expectedItemId4,
//     locationId: expectedLocationId4,
//     quantity: expectedQuantity4,
//     assignments: assignments
// });
return JSON.stringify({
    success: true,
    test: 'SHIPPING_STATUS_MEMO_CHECK',
    itemId: expectedItemId4,
    locationId: expectedLocationId4,
    quantity: expectedQuantity4,
    shippingStatus: shippingStatus4,
    memo: memo4,
    assignments: assignments
});
// TEST: SHIPPING STATUS AND MEMO:end

        // TEST: INVENTORY_STATUS_ASSIGNMENT: End

        // ============================================
// TEST: INVENTORY_DETAIL_CHECK:start
// ============================================
// ============================================
// TEST: INVENTORY_DETAIL_CHECK
// ============================================

const lineCount3 = fulfillment.getLineCount({
    sublistId: 'item'
});

const results = [];

for (let i = 0; i < lineCount3; i++) {

    const itemId = Number(fulfillment.getSublistValue({
        sublistId: 'item',
        fieldId: 'item',
        line: i
    }));

    const locationId = Number(fulfillment.getSublistValue({
        sublistId: 'item',
        fieldId: 'location',
        line: i
    }));

    const quantity = Number(fulfillment.getSublistValue({
        sublistId: 'item',
        fieldId: 'quantity',
        line: i
    }));

    const line = {
        itemId,
        locationId,
        quantity,
        hasInventoryDetail: false,
        assignments: []
    };

    if (fulfillment.hasSublistSubrecord({
        sublistId: 'item',
        fieldId: 'inventorydetail',
        line: i
    })) {

        const detail = fulfillment.getSublistSubrecord({
            sublistId: 'item',
            fieldId: 'inventorydetail',
            line: i
        });

        line.hasInventoryDetail = true;

        const count = detail.getLineCount({
            sublistId: 'inventoryassignment'
        });

        for (let j = 0; j < count; j++) {

            line.assignments.push({
                quantity: detail.getSublistValue({
                    sublistId: 'inventoryassignment',
                    fieldId: 'quantity',
                    line: j
                }),
                statusId: detail.getSublistValue({
                    sublistId: 'inventoryassignment',
                    fieldId: 'inventorystatus',
                    line: j
                }),
                binId: detail.getSublistValue({
                    sublistId: 'inventoryassignment',
                    fieldId: 'binnumber',
                    line: j
                }) || null
            });
        }
    }

    results.push(line);
}

return JSON.stringify({
    success: true,
    test: 'INVENTORY_DETAIL_CHECK',
    lines: results
});
// ============================================
// TEST: INVENTORY_DETAIL_CHECK;END
// ============================================

    // fulfillment location check: Start
// TEST: Validate item, quantity, and warehouse
const expectedItemId = Number(context.itemId);
const expectedQuantity = Number(context.quantity);
const expectedLocationId = Number(context.locationId);

const lineCount2 = fulfillment.getLineCount({
    sublistId: 'item'
});

const lines = [];

for (let i = 0; i < lineCount2; i++) {

    const itemId = Number(fulfillment.getSublistValue({
        sublistId: 'item',
        fieldId: 'item',
        line: i
    }));

    const quantity = Number(fulfillment.getSublistValue({
        sublistId: 'item',
        fieldId: 'quantity',
        line: i
    }));

    const locationId = Number(fulfillment.getSublistValue({
        sublistId: 'item',
        fieldId: 'location',
        line: i
    }));

    lines.push({
        itemId,
        quantity,
        locationId
    });
}

const matchingLines = lines.filter(line =>
    line.itemId === expectedItemId &&
    line.locationId === expectedLocationId
);

const matchedQuantity = matchingLines.reduce(
    (total, line) => total + line.quantity,
    0
);

return JSON.stringify({
    success: matchingLines.length > 0 &&
             matchedQuantity === expectedQuantity,
    test: 'ITEM_QUANTITY_VALIDATION',
    expectedItemId,
    expectedQuantity,
    expectedLocationId,
    matchedQuantity,
    lines
});

    // fulfillment location check: end

        // TEST: Verify the fulfillment location
const lineCounts = fulfillment.getLineCount({
    sublistId: 'item'
});

const locations = [];

for (let i = 0; i < lineCounts; i++) {

    const itemId = fulfillment.getSublistValue({
        sublistId: 'item',
        fieldId: 'item',
        line: i
    });

    const locationId = fulfillment.getSublistValue({
        sublistId: 'item',
        fieldId: 'location',
        line: i
    });

    const quantity = fulfillment.getSublistValue({
        sublistId: 'item',
        fieldId: 'quantity',
        line: i
    });

    locations.push({
        itemId: Number(itemId),
        locationId: Number(locationId),
        quantity: Number(quantity)
    });
}

return JSON.stringify({
    success: true,
    test: 'FULFILLMENT_LOCATION_CHECK',
    expectedLocationId: 5,
    locations: locations,
    locationValid: locations.every(
        line => line.locationId === 5
    )
});
    
// ignore for now, but we will need to set the shipping status to "Shipped" and add the CartonCloud dispatch ID to the memo field. This will help us identify the fulfillment in NetSuite and avoid duplicate fulfillments for the same dispatch.

 fulfillment.setValue({
    fieldId: 'shipstatus',
    value: 'C'
});
const dispatchId = context.dispatchId;

if (!dispatchId || typeof dispatchId !== 'string') {
    return {
        success: false,
        message: 'CartonCloud dispatchId is required'
    };
}

fulfillment.setValue({
    fieldId: 'memo',
    value: 'CartonCloud Dispatch: ' + dispatchId
});

const memo = fulfillment.getValue({
    fieldId: 'memo'
});

// ============================================
// Check existing CartonCloud dispatch
// ============================================

const duplicateResults = search.create({
    type: search.Type.ITEM_FULFILLMENT,

    filters: [
        ['createdfrom', 'anyof', String(soId)],
        'AND',
        ['mainline', 'is', 'T'],
        'AND',
        ['memo', 'is', memo]
    ],

    columns: [
        'internalid',
        'tranid',
        'memo'
    ]

}).run().getRange({
    start: 0,
    end: 10
});

const duplicateFulfillments = duplicateResults.map(result => ({
    internalId: result.id,

    fulfillmentNumber: result.getValue({
        name: 'tranid'
    }),

    memo: result.getValue({
        name: 'memo'
    })
}));
const shippingStatus = fulfillment.getValue({
    fieldId: 'shipstatus'
});

log.audit({
    title: 'Shipping Status Test',
    details: shippingStatus
});       
const requestedItemId = Number(context.itemId);
const requestedQuantity = Number(context.quantity);

const lineCount = fulfillment.getLineCount({
    sublistId: 'item'
});

let itemFound = false;

for (let i = 0; i < lineCount; i++) {

    const itemId = Number(
        fulfillment.getSublistValue({
            sublistId: 'item',
            fieldId: 'item',
            line: i
        })
    );

    const quantity = Number(
        fulfillment.getSublistValue({
            sublistId: 'item',
            fieldId: 'quantity',
            line: i
        })
    );

    if (itemId === requestedItemId) {

        itemFound = true;

        if (requestedQuantity <= 0 ||
            !Number.isFinite(requestedQuantity) ||
            requestedQuantity > quantity) {

            return {
                success: false,
                message: 'Invalid fulfillment quantity',
                requestedQuantity: requestedQuantity,
                availableToFulfill: quantity
            };
        }

            fulfillment.setSublistValue({
                sublistId: 'item',
                fieldId: 'itemreceive',
                line: i,
                value: true
            });

            fulfillment.setSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                line: i,
                value: requestedQuantity
            });

            const confirmedQuantity = fulfillment.getSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                line: i
            });

            const inventoryDetail = fulfillment.getSublistSubrecord({
    sublistId: 'item',
    fieldId: 'inventorydetail',
    line: i
});

const assignmentCount = inventoryDetail
    ? inventoryDetail.getLineCount({
        sublistId: 'inventoryassignment'
    })
    : 0;

  const assignments = [];

for (let j = 0; j < assignmentCount; j++) {

    const status = inventoryDetail.getSublistValue({
        sublistId: 'inventoryassignment',
        fieldId: 'inventorystatus',
        line: j
    });

    const quantity = inventoryDetail.getSublistValue({
        sublistId: 'inventoryassignment',
        fieldId: 'quantity',
        line: j
    });

    const binNumber = inventoryDetail.getSublistValue({
        sublistId: 'inventoryassignment',
        fieldId: 'binnumber',
        line: j
    });

    assignments.push({
        line: j,
        inventoryStatus: status,
        quantity: quantity,
        binNumber: binNumber
    });
}  

log.audit({
    title: 'Inventory Detail Check',
    details: JSON.stringify({
        itemId: itemId,
        quantity: confirmedQuantity,
        assignmentCount: assignmentCount
    })
});

const statusResults = search.create({
    type: 'inventorystatus',
    filters: [
        ['internalid', 'anyof', '1']
    ],
    columns: [
        'name'
    ]
}).run().getRange({
    start: 0,
    end: 1
});

const inventoryStatusName =
    statusResults.length > 0
        ? statusResults[0].getValue({
            name: 'name'
        })
        : null;
            // return {
            //     success: true,
            //     test: 'SET_FULFILLMENT_QUANTITY',
            //     salesOrderId: 853,
            //     itemId: itemId,
            //     requestedQuantity: requestedQuantity,
            //     confirmedQuantity: confirmedQuantity,
            //     message: 'Fulfillment quantity set successfully'
            // };
//          return {
//     success: true,
//     test: 'INVENTORY_DETAIL_CHECK',
//     salesOrderId: 853,
//     itemId: itemId,
//     quantity: confirmedQuantity,
//     inventoryDetailPresent: !!inventoryDetail,
//     assignmentCount: assignmentCount
// };  
//  return {
//     success: true,
//     test: 'INVENTORY_ASSIGNMENT_READ',
//     salesOrderId: 853,
//     itemId: itemId,
//     fulfillmentQuantity: confirmedQuantity,
//     assignmentCount: assignmentCount,
//     assignments: assignments
// };

const inventoryResults = search.create({
    type: search.Type.INVENTORY_ITEM,

    filters: [
        ['internalid', 'anyof', '1035'],
        'AND',
        ['inventorylocation', 'anyof', '2']
    ],

    columns: [
        'itemid',
        'inventorylocation',
        'locationquantityonhand',
        'locationquantityavailable',
        'locationquantitycommitted'

    ]

}).run().getRange({
    start: 0,
    end: 10
});

const inventory = inventoryResults.map(result => ({

    sku: result.getValue({
        name: 'itemid'
    }),

    locationId: result.getValue({
        name: 'inventorylocation'
    }),

    quantityOnHand: result.getValue({
        name: 'locationquantityonhand'
    }),

    quantityAvailable: result.getValue({
        name: 'locationquantityavailable'
    }),
    quantityCommitted: result.getValue({
    name: 'locationquantitycommitted'
})

}));

// return {
//     success: true,
//     test: 'INVENTORY_STATUS_CHECK',
//     salesOrderId: 853,
//     itemId: itemId,
//     fulfillmentQuantity: confirmedQuantity,
//     assignmentCount: assignmentCount,
//     inventoryStatusId: '1',
//     inventoryStatusName: inventoryStatusName,
//     assignments: assignments
// };

const soResults = search.create({
    type: search.Type.SALES_ORDER,

    filters: [
        ['internalid', 'anyof', '853'],
        'AND',
        ['mainline', 'is', 'F'],
        'AND',
        ['item', 'anyof', '1035']
    ],

    columns: [
        'tranid',
        'item',
        'quantity',
        'quantitycommitted',
        'quantityshiprecv'
    ]

}).run().getRange({
    start: 0,
    end: 10
});

const soLines = soResults.map(result => ({
    salesOrder: result.getValue({
        name: 'tranid'
    }),

    itemId: result.getValue({
        name: 'item'
    }),

    orderedQuantity: result.getValue({
        name: 'quantity'
    }),

    committedQuantity: result.getValue({
        name: 'quantitycommitted'
    }),

    fulfilledQuantity: result.getValue({
        name: 'quantityshiprecv'
    })
}));
// return {
//     success: true,
//     test: 'INVENTORY_AVAILABILITY_CHECK',
//     salesOrderId: 853,
//     itemId: 1035,
//     requestedQuantity: 2,
//     inventory: inventory
// };
const fulfillmentResults = search.create({
    type: search.Type.ITEM_FULFILLMENT,

    filters: [
        ['createdfrom', 'anyof', '853'],
        'AND',
        ['mainline', 'is', 'T']
    ],

    columns: [
        'internalid',
        'tranid',
        'createdfrom'
    ]

}).run().getRange({
    start: 0,
    end: 100
});

const existingFulfillments = fulfillmentResults.map(result => ({
    internalId: result.id,

    fulfillmentNumber: result.getValue({
        name: 'tranid'
    }),

    salesOrderId: result.getValue({
        name: 'createdfrom'
    })
}));

// return {
//     success: true,
//     test: 'SO_COMMITMENT_CHECK',
//     salesOrderId: 853,
//     itemId: 1035,
//     soLines: soLines
// };
// return {
//     success: true,
//     test: 'DUPLICATE_FULFILLMENT_CHECK',
//     salesOrderId: 853,
//     existingFulfillmentCount: existingFulfillments.length,
//     existingFulfillments: existingFulfillments
// };
// return {
//     success: true,
//     test: 'SHIPPING_STATUS_CHECK',
//     salesOrderId: 853,
//     shippingStatus: shippingStatus,
//     message: 'Shipping status set in memory'
// };
// return {
//     success: true,
//     test: 'DISPATCH_REFERENCE_CHECK',
//     salesOrderId: 853,
//     shippingStatus: fulfillment.getValue({
//         fieldId: 'shipstatus'
//     }),
//     dispatchId: dispatchId,
//     memo: memo
// };
return {
    success: true,
    test: 'DISPATCH_DUPLICATE_CHECK',
    salesOrderId: soId,
    dispatchId: dispatchId,
    duplicateCount: duplicateFulfillments.length,
    duplicateFulfillments: duplicateFulfillments
};
    }
}

if (!itemFound) {
    return {
        success: false,
        message: 'Item not found in Sales Order',
        itemId: requestedItemId
    };
}



    } catch (e) {
        log.error({
            title: 'TRANSFORM TEST ERROR',
            details: JSON.stringify({
                name: e.name,
                message: e.message,
                stack: e.stack
            })
        });

        return {
            success: false,
            test: 'TRANSFORM_TEST',
            error: {
                name: e.name,
                message: e.message,
                stack: e.stack
            }
        };
    }
}

    return {
        get: get,
        post: post
    };

});
