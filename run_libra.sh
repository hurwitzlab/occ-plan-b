JOB_ID=$1
IN_DIR=$2
KMER_SIZE=$3
NUM_TASKS=$4
FILTER_ALG=$5
RUN_MODE=$6
WEIGHTING_ALG=$7

MEM=32768M
LOG_FILE=/tmp/occ/occ.log
DONE_FILE=/tmp/occ/$JOB_ID.done

hadoop jar repos/libra/dist/libra-all.jar -D mapred.child.java.opts=-Xmx$MEM preprocess \
-k $3 \
-t $4 \
-f $5 \
-o /user/mbomhoff/occ/$JOB_ID/index \
$IN_DIR 2>&1 >> $LOG_FILE

hadoop jar repos/libra/dist/libra-all.jar core \
-m $RUN_MODE \
-w $WEIGHTING_ALG \
-t $NUM_TASKS \
-o /user/mbomhoff/occ/$JOB_ID/score/$WEIGHTING_ALG \
/user/mbomhoff/occ/$JOB_ID/index 2>&1 >> $LOG_FILE

touch $DONE_FILE
