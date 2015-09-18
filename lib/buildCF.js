var CantusFirmus = require('./CantusFirmus.js');
var CFstats = require('./CFstats.js');
var Pitch = require('./Pitch.js');
var Stack = require('./Stack.js');
var WeightedBag = require('./WeightedBag.js');
var MaxPQ = require('./MaxPQ.js');

// default choices to be used if not provided to constructor
var defaultTonics = ["G4", "F4", "A4"];
var defaultModes = ["major", "minor", "dorian", "mixolydian"];
var defaultMinLength = 8;
var defaultMaxLength = 16;
var defaultMaxRange = 10;


var MELODIC_INTERVALS = ['m2','M2','m3','M3','P4','P5','m6','M6','P8']; // consonant melodic intervals
var MAX_OUTLINE_LENGTH = 5; // max number of notes in a single direction in a row
var MAX_OUTLINE_SIZE = 8;   // largest size notes can move in a single direction
var INTERVALS_AFTER_DIRECTION_CHANGE = [2,3,4,5,6,8];
var INTERVAL_WEIGHT_AT_START = {
    2: 4,
    3: 4,
    4: 3,
    5: 4,
    6: 4,
    8: 1,
    '-2': 3,
    '-3': 1,
    '-4': 3,
    '-5': 1,
    '-6': 3,
    '-8': 0.5
};
var INTERVAL_WEIGHT_AFTER_LEAP = {
    2: 2,
    3: 1
};
var INTERVAL_WEIGHT_DIRECTION_CHANGE = {
    2: 2,
    3: 2,
    4: 2,
    5: 2,
    6: 2,
    8: 1
};
var INTERVAL_WEIGHT_SAME_DIRECTION = {
    2: 7,
    3: 3,
    4: 1,
    5: 1,
};
// probability of continuing in the same direction when there is a choice
var CONTINUE_DIRECTION_PROBABILITY = 0.65;


function buildCF(startCF, goalLength, maxRange) {
    if (!startCF) {
        var tonic = new Pitch(defaultTonics[uniformRandom(defaultTonics.length)]);
        var mode = defaultModes[uniformRandom(defaultModes.length)];
        startCF = new CantusFirmus([tonic], mode);
    }
    if (!goalLength)
        goalLength = uniformRandom(defaultMinLength, defaultMaxLength + 1); 
    if (!maxRange)
        maxRange = defaultMaxRange
    var goalLength = goalLength;
    var maxRange = maxRange;

    // build the CF
    var cfs = new MaxPQ(cfRatingIsLess);  // stack with partially built Cantus Firmi
    cfs.insert(startCF);


    var stackPopNumber = 0;
    var cfsPulled = [];
    var candidateCFs = []; 
    console.log("   startCF = " + startCF);
    console.log("goalLength = " + goalLength);
    console.log("  maxRange = " + maxRange);
    var NUMBER_CF_TO_BUILD = 3;
    while(!cfs.isEmpty() && candidateCFs.length < NUMBER_CF_TO_BUILD) {
        var cf = cfs.delMax();                 // take the top option off the stack
        var lastNote = cf.cf[cf.length - 1];

        // bug checking ************
        cfsPulled.push(cf);
        console.log("\n" + stackPopNumber++);
        console.log(String(cf));
        console.log("priority score = " + calculatePriority(cf));
        // end bug checking ********

        // if this is the first note, add all possible choices and continue
        if (cf.length == 1) {
            var bag = new WeightedBag();
            for (var intervalName in INTERVAL_WEIGHT_AT_START) {
                var interval = Number(intervalName);
                if (goalLength < 10) {
                    if (interval == 8 || interval == -8)
                        continue;  // don't add octave because there is not room to complete it
                }
                var note = cf.key.intervalFromPitch(lastNote, interval);
                bag.add(note, INTERVAL_WEIGHT_AT_START[interval]);
            }
            var nextNoteStack = new Stack();
            // NOTE trying to only add one second note for more variety in results
            cfs.insert(cf.addNote(bag.remove()));
            continue;
        }

        cf.stats = new CFstats(cf);         // build and attach stats for this cf 

        // build helper functions for checking if note is possible
        var formsValidInterval = function(pitch) {
            return MELODIC_INTERVALS.indexOf(lastNote.interval(pitch)) > -1;
        };
        var maxNote = cf.key.intervalFromPitch(cf.stats.lowestNote,   maxRange);
        var minNote = cf.key.intervalFromPitch(cf.stats.highestNote, -maxRange);
        // if highest note is currently repeated, leave room for climax by raising minNote by a step
        if (cf.stats.noteUsage[cf.stats.highestNote.sciPitch] > 1) {
            minNote = cf.key.intervalFromPitch(minNote, 2);
            if (cf.length == goalLength - 1) // if this is the end, there is no climax so it won't work
                continue;
        }
        //console.log("maxNote: " + maxNote);
        //console.log("minNote: " + minNote);
        // function used to test if potential note is in range
        var inRange = function(pitch) {
            if (pitch.isLower(maxNote) && pitch.isHigher(minNote))
                return true;
            if (pitch.equals(maxNote) || pitch.equals(minNote))
                return true;
            return false;
        };
        //  black list of notes that are ruled out for nextNote
        var blackList = []; // an array of notes as strings in sciPitch 
        var inBlackList = function(pitch) {
            return blackList.indexOf(pitch.sciPitch) > -1;
        };
        // combine all helper functions into one
        var isValidNextNote = function(pitch) {
            return formsValidInterval(pitch) && inRange(pitch) && !inBlackList(pitch);
        };

        // build black list
        // if last interval was 3 or 4, don't leap back to the same note
        if (cf.length >= 2) { // avoids patterns such as 1 3 1 or 2 5 2
            if (cf.stats.lastInterval == 3 || cf.stats.lastInterval == 4)
                blackList.push(cf.cf[cf.length - 2].sciPitch);
        }
        // check for pattern of note groups of length 2 (such as 2 1 2 1)
        if (cf.length >= 3) {
            if (cf.cf[cf.length - 3].equals(cf.cf[cf.length - 1]))
                blackList.push(cf.cf[cf.length - 2].sciPitch); // using this note would form pattern
        }
        // check for pattern of note groups of length 3 (such as 3 2 1 3 2 1)
        if (cf.length >= 5) {
            if (cf.cf[cf.length - 5].equals(cf.cf[cf.length - 2])) {
                if (cf.cf[cf.length - 4].equals(cf.cf[cf.length - 1]))
                    blackList.push(cf.cf[cf.length - 3].sciPitch);
            }
        }
        // make sure all notes within range are used -- if end is near, add all used notes
        if (goalLength - cf.length > 1) { // if not last note
            // subtract 1 because all notes need to be used 1 before end since last note is tonic
            if (goalLength - cf.length - 1 <= cf.stats.range - cf.stats.uniqueNotes) {
                if (goalLength - cf.length - 1 < cf.stats.range - cf.stats.uniqueNotes)
                    continue; // it is not possible to use all notes in range now
                Object.keys(cf.stats.noteUsage).forEach(function(noteName) {
                    blackList.push(noteName);
                });
            } // don't use any note thrice until 3 notes used twice
            else if(cf.stats.timesNotesUsed[2] <= 3) {
                if (cf.stats.timesNotesUsed[2]) {
                    for (var noteName in cf.stats.noteUsage) {
                        if (cf.stats.noteUsage[noteName] == 2)
                            blackList.push(noteName);
                    }
                }
            }
        } else if (cf.stats.range - cf.stats.uniqueNotes != 0) {
            continue; // skip this option if all notes not used for last note
        }

        var direction = 1;
        if (!cf.stats.isAscending)
            direction *= -1; 
        var nextNoteChoices = new Stack();
        // can change direction?             check for consonant outlined interval
        var changeDirection = MELODIC_INTERVALS.indexOf(cf.stats.outlinedInterval) > -1;

        // if last interval was > 3, recover from leap
        if (cf.stats.lastInterval > 3) {
            if (!changeDirection)
                continue;   // there are no possible routes from this cf 
            var bag = new WeightedBag();
            for (var intervalName in INTERVAL_WEIGHT_AFTER_LEAP) {
                var interval = Number(intervalName);
                var newNote = cf.key.intervalFromPitch(lastNote, interval * -direction);
                if (isValidNextNote(newNote))
                    bag.add(newNote, INTERVAL_WEIGHT_AFTER_LEAP[interval]);
            }
            // put on new stack so first picked from bag will be last added to cfs stack
            while (!bag.isEmpty())
                nextNoteChoices.push(bag.remove());
        }
        else {
            // if no leaps and not first note, now find all possibilities
            var directionChangeStack = new Stack();
            var sameDirectionStack = new Stack();

            // can continue in same direction?   check outline length < 5
            var continueDirection = cf.stats.lastOutlineLength < MAX_OUTLINE_LENGTH;
            // can change direction?             check for consonant outlined interval
            var changeDirection = MELODIC_INTERVALS.indexOf(cf.stats.outlinedInterval) > -1;

            if (changeDirection) {
                // if last interval was 3 or 4 add notes to blackList that would from a triad
                if (cf.stats.lastInterval == 3) {
                    blackList.push(cf.key.intervalFromPitch(lastNote, 5 * -direction).sciPitch);
                    blackList.push(cf.key.intervalFromPitch(lastNote, 6 * -direction).sciPitch);
                }
                if (cf.stats.lastInterval == 4)
                    blackList.push(cf.key.intervalFromPitch(lastNote, 6 * -direction).sciPitch);
                // try to add to directionChangeStack
                var bag = new WeightedBag();
                for (var intervalName in INTERVAL_WEIGHT_DIRECTION_CHANGE) {
                    var interval = Number(intervalName);
                    var newNote = cf.key.intervalFromPitch(lastNote, interval * -direction);
                    if (isValidNextNote(newNote))
                        bag.add(newNote, INTERVAL_WEIGHT_DIRECTION_CHANGE[interval]);
                }
                // put on new stack so first picked from bag will be last added to cfs stack
                //console.log("Bag of Direction Change Choices:\n" + bag);
                while (!bag.isEmpty())
                    directionChangeStack.push(bag.remove());
            }

            if (continueDirection) {
                var intervalChoices = [2];               // only moves by step if last interval was > 2
                if (cf.stats.lastInterval == 2) {
                    if (cf.stats.lastOutlineLength > 2)  // if already moving in same direction for > 2 notes
                        intervalChoices.push(3);         // no big leaps, only add 3
                    else 
                        intervalChoices.push(3, 4, 5);   // else add 4 and 5 to possibilities 
                }
                var bag = new WeightedBag();
                intervalChoices.forEach(function(interval) {
                    // new outlined interval must be within an octave (8)
                    if (interval + cf.stats.outlinedIntervalSize - 1 <= 8) {
                        var newNote = cf.key.intervalFromPitch(lastNote, interval * direction);
                        if (isValidNextNote(newNote))
                            bag.add(newNote, INTERVAL_WEIGHT_SAME_DIRECTION[interval]);
                    }
                });
                //console.log("Bag of Same Direction Choices:\n" + bag);
                while (!bag.isEmpty())
                    sameDirectionStack.push(bag.remove());
            }

            // flip a coin to see whether to change direcion first or continue first
            if (Math.random() < CONTINUE_DIRECTION_PROBABILITY) {
                while (!sameDirectionStack.isEmpty())
                    nextNoteChoices.push(sameDirectionStack.pop());
                while (!directionChangeStack.isEmpty())
                    nextNoteChoices.push(directionChangeStack.pop());
            }
            else {
                while (!directionChangeStack.isEmpty())
                    nextNoteChoices.push(directionChangeStack.pop());
                while (!sameDirectionStack.isEmpty())
                    nextNoteChoices.push(sameDirectionStack.pop());
            }
        }
        // check if next note is penultimate 
        if (cf.length == goalLength - 2) {
            // penultimate note must be scale degree 2
            var scaleDegree2 = cf.key.intervalFromPitch(cf.cf[0], 2);
            while (!nextNoteChoices.isEmpty()) {
                if (nextNoteChoices.pop().equals(scaleDegree2))
                    cfs.insert(cf.addNote(scaleDegree2));
            }
            continue;   // if not present, end search from this route
        }

        // check if next note is the last note
        if (cf.length == goalLength - 1) {
            // final note must be scale degree 1
            var scaleDegree1 = cf.cf[0];
            while (!nextNoteChoices.isEmpty()) {
                if (nextNoteChoices.pop().equals(scaleDegree1)) {
                    // log all cfs pulled for error checking **********
                    cfsPulled.forEach(function(cf, index) {
                        //console.log(index + ": " + cf);
                    });
                    // end error checking *****************************
                    candidateCFs.push(cf.addNote(scaleDegree1));            // cf is built!
                }
            }
            continue;  // if not present, end search from this route
        }
        var notesAdded = [];
        // add all possibilities to cfs stack
        while (!nextNoteChoices.isEmpty()) {
            var nextNote = nextNoteChoices.pop();
            notesAdded.push(nextNote);
            cfs.insert(cf.addNote(nextNote));
        }
        //console.log("NextNoteChoices: " + notesAdded);
        //console.log("      BlackList: " + blackList);
        //console.log("\n");
    }
    var NUMBER_SELECTIONS_TO_LOG = 10;
    if (NUMBER_SELECTIONS_TO_LOG > NUMBER_CF_TO_BUILD)
        NUMBER_SELECTIONS_TO_LOG = NUMBER_CF_TO_BUILD;
    console.log("\n\n*********************SELECTIONS*********************");
    for (var i = 0; i < NUMBER_SELECTIONS_TO_LOG; i++) {
        console.log("cf " + i + ": " + candidateCFs[i]);
        console.log("         priority = " + calculatePriority(candidateCFs[i]));
    }
    
    console.log("\n\n**************SORTED SELECTIONS*********************");
    candidateCFs.sort(sortByPriority);
    for (var i = 0; i < NUMBER_SELECTIONS_TO_LOG; i++) {
        console.log("cf " + i + ": " + candidateCFs[i]);
        console.log("         priority = " + calculatePriority(candidateCFs[i]));
    }
    return candidateCFs[0];
    // throw new Error("No CF was possible."); // if stack of possibilities is empty
}

// heuristic comparator function passed to MaxPQ to compare cfs
function cfRatingIsLess(a, b) {
    if (!a.priority)
        a.priority = calculatePriority(a);
    if (!b.priority)
        b.priority = calculatePriority(b);
    return a.priority < b.priority;
}

// heuristic used to decide how good (balanced) a cf is
function calculatePriority(cf) {
    if (!cf.stats)
        cf.stats = new CFstats(cf);

    //console.log("*** calculating Priority for " + cf);
    var score = cf.length;
    //console.log("set score equal to length: " + score);
    // penalty for high standard deviation of note weight
    if (cf.stats.noteWeights.stdDeviation > 1 && cf.length > 2)
        score -= (cf.stats.noteWeights.stdDeviation - 1) * cf.length;
    //console.log("stdDeviation of noteWeights = " + cf.stats.noteWeights.stdDeviation);
    //console.log("score = " + score);
    
    // penalty if seconds are not at least 54% of intervals
    if (cf.length > 3) {
        var desiredSeconds = (cf.length - 1) / 1.85;
        if (cf.stats.intervalUsage[2] < desiredSeconds)
            score -= desiredSeconds - cf.stats.intervalUsage[2];
        //console.log("desiredSeconds = " + desiredSeconds + " and actual seconds = " + cf.stats.intervalUsage[2]);
        //console.log("score = " + score);
    }
    // subtract 1 point for each octave leap after the first
    if (cf.stats.intervalUsage[8] > 1)
        score -= cf.stats.intervalUsage[8] - 1;

    // penalty for too many or too few leaps
    if (cf.stats.leaps > 4)        // -1 for each extra leap
        score -= cf.stats.leaps - 4;
    else if (cf.length >= 5) {
        var deduction = (cf.stats.leaps - cf.length / 4) * 2; // 2-4 leaps for cf of 8-16 length * 2 for more weight
        if (deduction < 0) // no bonus added if this number is positive
            score += deduction;
    }

    /*
    // directions should be relatively balanced
    if (cf.length > 6) {
        var directions = this.directionStats();
        var offBalance = Math.abs(directions.up - directions.down) - 2;
        score -= offBalance * (cfLength / 8);
    }
    */
    return score;
}

// highest priority first
function sortByPriority(a, b) {
    if (!a.priority)
        a.priority = calculatePriority(a);
    if (!b.priority)
        b.priority = calculatePriority(b);
    if (a.priority > b.priority)
        return -1;
    if (a.priority < b.priority)
        return 1;
  return 0;
}


// helper function that returns an integer between [a,b) (b exclusive)
// if b is not provided, returns an integer between [0,a) 
function uniformRandom(a, b) {
    if (!b) {
        b = a;
        a = 0;
    }
    return a + Math.floor(Math.random() * (b - a));
}

module.exports = buildCF;