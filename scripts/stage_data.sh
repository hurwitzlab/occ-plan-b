#!/bin/sh -x

IRODS_PATH=$1
JOB_ID=$2
STAGING_PATH=$3
HDFS_PATH=$4

echo $0 $@

mkdir -p $STAGING_PATH
hdfs dfs -mkdir -p $HDFS_PATH

filelist=`ils $IRODS_PATH | sed -n '1!p'`

for f in $filelist
do
    echo $IRODS_PATH/$f

    iget -PTf $IRODS_PATH/$f $STAGING_PATH

    ext="${f##*.}"
    name="${f%.*}"

    if [[ "$ext" = "gz" || "$ext" = "gzip" ]]; then
        gunzip --stdout $STAGING_PATH/$f | bzip2 > $STAGING_PATH/$name.bz2
        rm $STAGING_PATH/$f
        f=$name.bz2
    fi

    hdfs dfs -put -f $STAGING_PATH/$f $HDFS_PATH

    rm $STAGING_PATH/*
done

rm -r $STAGING_PATH

echo "All done!"